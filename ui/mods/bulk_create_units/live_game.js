define(['bulk_create_units/qmath'], function(VMath) {
  // Pointer tracking
  var mouseX = 0
  var mouseY = 0
  var hdeck = model.holodeck
  var mousetrack = function(e) {
    mouseX = e.offsetX
    mouseY = e.offsetY
    hdeck = $(this).data('holodeck')
  }

  if (model.cheatAllowCreateUnit()) {
    $('body').on('mousemove', 'holodeck', mousetrack)
  }

  model.cheatAllowCreateUnit.subscribe(function(value) {
    if (value) {
      $('body').on('mousemove', 'holodeck', mousetrack)
    } else {
      $('body').off('mousemove', 'holodeck', mousetrack)
    }
  })

  armyIndex = ko.computed(function() {
    return model.playerControlFlags().indexOf(true)
  })

  // keep puppetmaster's special effects if it's present
  model.pasteUnits = model.pasteUnits || function(n) {
    if (!model.cheatAllowCreateUnit()) return
    if (n < 1) return
    if (armyIndex() == -1) return
    var army_id = model.players()[armyIndex()].id

    var scale = api.settings.getSynchronous('ui', 'ui_scale') || 1.0;

    var x = Math.floor(mouseX * scale);
    var y = Math.floor(mouseY * scale);

    hdeck.raycast(x, y).then(function(result) {
      //console.log(result)
      var drop = {
        army: army_id,
        what: selectedUnit(),
        planet: result.planet,
        location: result.pos,
        orientation: result.orient,
      }
      pasteUnits3D(n, drop)
    })
  }

  // http://stackoverflow.com/a/31864777/30203
  var spiral = function(N, f) {
    var x = 0;
    var y = 0;
    for (var i = 0;i < N;i++) {
      f(i, x, y)
      if(Math.abs(x) <= Math.abs(y) && (x != y || x >= 0)) {
        x += ((y >= 0) ? 1 : -1);
      } else {
        y += ((x >= 0) ? -1 : 1);
      }
    }
  }

  model.baseSize = 10
  model.unitAdj = 1
  model.sepAdj = 2

  var pasteUnits3D = function(n, config) {
    if (!model.cheatAllowCreateUnit()) return
    if (n < 1) return
    if (!config.what || config.what == '') return

    var locations = []
    for (var i = 0;i < n;i++) {
      locations[i] = {
        pos: config.location,
        orient: config.orientation,
      }
    }

    var sizeData = model.sizeData()[config.what]
    //console.log(sizeData)

    var dx = model.baseSize
    var dy = model.baseSize

    //console.log(dx, dy)

    if (sizeData.placement_size) {
      dx += sizeData.placement_size[0] * model.unitAdj
      dy += sizeData.placement_size[1] * model.unitAdj
    } else if (sizeData.mesh_bounds) {
      dx += sizeData.mesh_bounds[0] * model.unitAdj
      dy += sizeData.mesh_bounds[1] * model.unitAdj
    }

    //console.log(dx, dy)

    if (sizeData.area_build_separation) {
      dx += sizeData.area_build_separation * model.sepAdj
      dy += sizeData.area_build_separation * model.sepAdj
    }

    //console.log(dx, dy)

    var r = VMath.length_v3(config.location)

    var gx = VMath.apply_q([1, 0, 0, 0], config.orientation)
    var gy = VMath.apply_q([0, 1, 0, 0], config.orientation)
    var gz = VMath.apply_q([0, 0, 1, 0], config.orientation)

    //console.log(gx, gy, gz)
    //console.log(config.location)

    spiral(n, function(i, x, y) {
      //console.log(i, x, y)
      var loc = locations[i]
      //console.log(loc)
      x = x*dx
      y = y*dy
      //console.log(x, y)
      var l = VMath.length_v2([x, y])
      if (l == 0) {
        var vx = 0
        var vy = 0
      } else {
        var vx = x/l
        var vy = y/l
      }
      var a = l/r - Math.PI/2
      var c = Math.cos(a)
      var s = -(1+Math.sin(a))
      //console.log(l, r, a, c, s)
      var x3 = r*c*vx
      var y3 = r*c*vy
      var z3 = r*s
      loc.pos = [
        loc.pos[0] + gx[0]*x3 + gy[0]*y3 + gz[0]*z3,
        loc.pos[1] + gx[1]*x3 + gy[1]*y3 + gz[1]*z3,
        loc.pos[2] + gx[2]*x3 + gy[2]*y3 + gz[2]*z3,
      ]
      //console.log([x, y], [x3, y3, z3], loc.pos)
    })
    //console.log(locations)

    hdeck.view.fixupBuildLocations(config.what, config.planet, locations).then(function(fixup) {
      //console.log(fixup)

      fixup.forEach(function(loc) {
        //console.log(loc.ok, loc.desc, loc.pos, loc.orient)

        if (sizeData && sizeData.feature_requirements && !loc.ok) {
          console.log(loc.desc)
          return
        }
        config.location = loc.pos || config.location
        config.orientation = loc.orient || config.orientation
        model.send_message('create_unit', config)
      })
    })
  }

  model.bulkPasteCount = ko.observable(10)
  model.bulkPaste = function() {
    model.pasteUnits(model.bulkPasteCount())
  }

  handlers.bulk_paste_count = model.bulkPasteCount

  var lastHover = ''
  var selectedUnit = ko.observable(lastHover)

  selectedUnit.subscribe(function(spec) {
    api.Panel.message('sandbox', 'bulkCreateUnitSpec', spec)
    loadSize()
  })

  handlers.bulkCreateUnitSelected = function(spec) {
    selectedUnit(spec)
  }

  var liveGameHover = handlers.hover
  handlers.hover = function(payload) {
    liveGameHover(payload)

    if (payload) {
      lastHover = payload.spec_id || ''
    }
  }

  var engineCall = engine.call
  engine.call = function(method) {
    var promise = engineCall.apply(this, arguments);

    if (method == 'unit.debug.copy') {
      selectedUnit(lastHover)
    } else if (method == 'unit.debug.setSpecId') {
      var spec = arguments[1]
      var unit = model.unitSpecs[spec]
      selectedUnit(spec)
    }

    return promise
  }

  model.sizeData = ko.observable({})
  var sizeLoaded = false
  var loadSize = function() {
    if (sizeLoaded) return
    sizeLoaded = true
    unitInfoParser.loadUnitData(
    model.sizeData,
    function(spec) {
      return {
        display_name: spec.display_name,
        area_build_separation: spec.area_build_separation,
        area_build_type: spec.area_build_type,
        mesh_bounds: spec.mesh_bounds,
        placement_size: spec.placement_size,
        physics: spec.physics,
        feature_requirements: spec.feature_requirements,
      }
    }, function(a, b) {
      var result = {
        display_name: a.display_name || b.display_name,
        area_build_separation: a.area_build_separation || b.area_build_separation,
        area_build_type: a.area_build_type || b.area_build_type,
        mesh_bounds: a.mesh_bounds || b.mesh_bounds,
        placement_size: a.placement_size || b.placement_size,
        physics: _.extend({}, a.physics, b.physics),
        feature_requirements: a.feature_requirements || b.feature_requirements,
      }
      //console.log('combine', a.display_name, b.display_name, a, b, result)
      return result
    })
  }

  handlers.bulkCreateUnitSandboxExpanded = function(open) {
    if (open) {
      loadSize()
    }
  }
})
