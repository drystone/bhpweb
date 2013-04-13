$(function() {
    var eventSource = new EventSource('bhpweb.events');
    
    eventSource.addEventListener('zones', function(e) {
        var list = $('<ul id="bhpweb"/>');
        JSON.parse(e.data).forEach(function(z) {
            var boostClicks = 0;
            var boostTimer = null;
            function boost(e) {
                if (boostTimer) {
                    clearTimeout(boostTimer);
                    boostTimer = null;
                }
                if (++boostClicks == 4) {
                    boostClicks = 0;
                } else {
                    boostTimer = setTimeout(function() {
                        $.ajax('override', {
                            data : {
                                zid  : z.id
                              , type : 'boost'
                              , duration : [30, 60, 120][boostClicks - 1] * 60
                            }, type : 'POST'
                        });
                        boostClicks = 0;
                    }, 2000);
                }
            }
            var item = $('<li/>').attr('id', z.id)
            .data('temp', {'on' : z.on, 'standby' : z.standby, 'off' : z.off})
            .append($('<heading/>').append(z.name))
            .append($('<div/>').addClass('temp'))
            .append($('<div/>').addClass('timers'))
            .append($('<button/>').addClass('boost').text('boost').click(boost))
            .append($('<button/>').addClass('advance').text('advance'));
            list.append(item);
        });
        $('#bhpweb').replaceWith(list);
    });

    eventSource.addEventListener('temperatures', function(e) {
        var temperatures = JSON.parse(e.data);
        for (var id in temperatures) {
            $('#' + id + ' .temp').text(new Number(temperatures[id]).toFixed(1));
        }
    });

    eventSource.addEventListener('routines', function(e) {
        JSON.parse(e.data).forEach(function(r) {
            var switches = r.switches.map(function(s) {
                return {'time' : s.time - r.switches[0].time, 'state' : s.state};
            });
            var svg = $('<svg height="20"/>');
            for (var s = 0, i = 1, w = 400, h = 20; i < switches.length; i++) {
                var e = switches[i].time / (48 * 60 * 60) * w;
                svg.append($('<rect/>').addClass(switches[i-1].state).attr('x',s).attr('width',e-s).attr('height',h));
                s = e;
            }
            var s = '#' + r.zone + ' .timers';
            $(s).replaceWith($('<div/>').addClass('timers').append(svg));
            // jiggery pokery to get the svg visible
            $(s).html($(s).html());
        });
    });
});

