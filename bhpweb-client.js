$(function() {
    var eventSource = new EventSource('bhpweb.events');
    
    eventSource.addEventListener('zones', function(e) {
        var list = $('<ul id="bhpweb"/>');
        JSON.parse(e.data).forEach(function(z) {
            var item = $('<li/>').attr('id', z.id);
            item.append($('<heading/>').append(z.name));
            item.append($('<div/>').addClass('temp'));
            item.append($('<div/>').addClass('timers'));
            item.append($('<button/>').addClass('boost').text('boost'));
            item.append($('<button/>').addClass('advance').text('advance'));
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
                return {'time' : s.time - r.switches[0].time, 'temp' : s.temp};
            });
            var svg = $('<svg height="20"/>');
            for (var s = 0, i = 1, w = 400, h = 20; i < switches.length; i++) {
                var e = switches[i].time / (48 * 60 * 60) * w;
                var t = switches[i-1].temp / 20 * h;
                svg.append($('<rect/>').attr('y',h-t).attr('x',s).attr('width',e-s).attr('height',t));
                s = e;
            }
            var s = '#' + r.zone + ' .timers';
            $(s).replaceWith($('<div/>').addClass('timers').append(svg));
            // jiggery pokery to get the svg visible
            $(s).html($(s).html());
        });
    });
});

