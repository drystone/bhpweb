// bhpweb - web interface to the bhp heating system 
// Copyright 2013 John Hedges <john@drystone.co.uk>
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
// more details.
//
// You should have received a copy of the GNU General Public License along
// with this program; if not, write to the Free Software Foundation, Inc., 51
// Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

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
            .append($('<button/>').addClass('boost').text('boost').click(boost))
            .append($('<div/>').addClass('timers'));
            list.append(item);
        });
        $('#bhpweb').replaceWith(list);
    });

    eventSource.addEventListener('temperatures', function(e) {
        var temperatures = JSON.parse(e.data);
        for (var id in temperatures) {
            $('#' + id + ' .temp').text(new Number(temperatures[id]).toFixed(1) + '°');
        }
    });

    eventSource.addEventListener('routines', function(e) {
        JSON.parse(e.data).forEach(function(r) {
            timerStart = r.switches[0].time;
            timerWidth = $('#' + r.zone).width() - $('#' + r.zone + ' button').outerWidth();
            timerHeight = $('#' + r.zone + ' button').outerHeight();

            var preBoost = $('#' + r.zone + ' .timers').find('.preboost');
            var svg = $('<svg>').css('width', timerWidth).css('height', timerHeight);
            for (var s = r.switches[0].time, i = 1; i < r.switches.length; i++) {
                svg.append(mkrect(r.switches[i-1].state, s, r.switches[i].time));
                s = r.switches[i].time;
            }
            var last = r.switches[r.switches.length-1];
            svg.append(mkrect(last.state, last.time, timerStart + timerDuration));
            
            if (preBoost.size()) {
                preBoost.remove();
                svg.append(preBoost);
            }
            else if (r.boost) {
                svg.append(mkrect('boost', r.boost.start, r.boost.end));
            }
            $('#' + r.zone + ' .timers').replaceWith($('<div/>').addClass('timers').css('width', timerWidth).append(svg));
            pokeSVG(r.zone);
        });
    });
});

