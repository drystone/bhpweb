$(function() {
    var timerHeight = 20;
    var timerWidth = 400;
    var timerDuration = 6*60*60;
    var timerStart = 0;

    function timerOffset(s) { return (s - timerStart) / timerDuration * timerWidth; }
    function mkrect(cssClass, start, end) {
        return $('<rect/>')
        .addClass(cssClass)
        .attr('x', timerOffset(start))
        .attr('y', 0)
        .attr('width', timerOffset(end) - timerOffset(start))
        .attr('height', timerHeight);
    }
    function pokeSVG(z) {
            // jiggery pokery to get the svg visible
        var s = '#' + z + ' .timers';
        $(s).html($(s).html());
    }

    function boostSecs(numClicks) { return [0, 30*60, 60*60, 120*60][numClicks]; }

    var eventSource = new EventSource('bhpweb.events');
    
    eventSource.addEventListener('zones', function(e) {
        var list = $('<ul id="bhpweb"/>');
        JSON.parse(e.data).forEach(function(z) {
            var boostClicks = 0;
            var boostTimer = null;
            function boost(e) {
                $('#' + z.id + ' rect.boost').remove();
                $('#' + z.id + ' rect.preboost').remove();
                if (boostTimer) {
                    clearTimeout(boostTimer);
                    boostTimer = null;
                }
                if (++boostClicks == 4) boostClicks = 0;

                $('#' + z.id + ' svg').append(mkrect('preboost', timerStart, timerStart + boostSecs(boostClicks)));
                boostTimer = setTimeout(function() {
                    $.ajax('override', {
                        data : {
                            zid  : z.id
                          , type : 'boost'
                          , duration : boostSecs(boostClicks)
                        }, type : 'POST'
                    });
                    boostClicks = 0;
                    boostTimer = null;
                    $('#' + z.id + ' rect.preboost').remove();
                }, 2000);
                pokeSVG(z.id);
            }
            var item = $('<li/>').attr('id', z.id)
            .data('temp', {'on' : z.on, 'standby' : z.standby, 'off' : z.off})
            .append($('<heading/>').append(z.name))
            .append($('<div/>').addClass('temp'))
            .append($('<div/>').addClass('timers'))
            .append($('<button/>').addClass('boost').text('boost').click(boost));
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
            var preBoost = $('#' + r.zone + ' .timers').find('.preboost');
            var svg = $('<svg height="20"/>');
            for (var s = 0, i = 1; i < r.switches.length; i++) {
                svg.append(mkrect(r.switches[i-1].state, s, r.switches[i].time));
                s = r.switches[i].time;
            }
            if (preBoost.size()) {
                preBoost.remove();
                svg.append(preBoost);
            }
            else if (r.boost) {
                svg.append(mkrect('boost', r.boost.start, r.boost.end));
            }
            $('#' + r.zone + ' .timers').replaceWith($('<div/>').addClass('timers').append(svg));
            pokeSVG(r.zone);
            timerStart = r.switches[0].time;
        });
    });
});

