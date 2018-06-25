/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var isDebugMode = true
console.debug = function(args) {
  if (isDebugMode){
    console.log(args);
  }
}

var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs    = require('fs');
var https = require('https');


// gets query string

function decodeQueryString(urlString) {
	var qs = (function(a) {
	    if (a == "") return {};
	    var b = {};
	    for (var i = 0; i < a.length; ++i)
	    {
	        var p=a[i].split('=', 2);
	        if (p.length == 1)
	            b[p[0]] = "";
	        else
	            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
	    }
	    return b;
	})(urlString.split('?')[1].split('&'));

	return qs
}


// const querystring = require('querystring');
// console.log('querystring', querystring.parse)


var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://13.251.137.224:8888/kurento'
    }
});

var options = {
  key:  fs.readFileSync('keys/server.key'),
  cert: fs.readFileSync('keys/server.crt')
};

var app = express();

/*
 * Definition of global variables.
 */
var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;
// var presenter = null;
// hold multiple presenters by channel id
var presenters = {
	// 'Channel_abc_eng': presenter,
};


// used to notify channel Subscribers when channels are being presented with
var channelStatusSubscribers = {
	// 'Channel_abc_eng': [session1, session2....]
};

var viewersByChannel = {
	// 'Channel_abc_eng': [],
};

var noPresenterMessage = 'No active presenter. Try again later...';

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);

console.log( url)
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server : server,
    path : '/one2many'
});

function nextUniqueId() {
	idCounter++;
	return idCounter.toString();
}


// detect if client is still alive
function noop() {}

function heartbeat() {

	console.log('heartbeat detected')
  	this.isAlive = true;
}

function isAuthenticated(qs) {
	// return true
	var channelId = qs.channel

	if (!presenterKeys[channelId]) {
		console.log('presenterKeys[channelId]', presenterKeys[channelId])
		return false
	}

	if (presenterKeys[channelId].key != qs.pkey ) {
		console.log('presenterKeys[channelId].key', presenterKeys[channelId].key, qs.pkey)
		return false
	}

	console.log('presenterKeys[channelId].key', presenterKeys[channelId].key, qs.pkey)

	return true
}

/*
 * Management of WebSocket messages
 */
wss.on('connection', function connection(ws, req) {

	var sessionId = nextUniqueId();
	console.log('Connection received with sessionId ' + sessionId);
	// console.log(req)

	var qs = decodeQueryString(req.url)
	console.log('qs', qs)
	var channelId = qs.channel
	// console.log(`channel id ${channelId}`);

	// Pong messages are automatically sent in response to ping messages as required by the spec.
	// detect if client is alive
	ws.channelId = channelId;
	ws.sessionId = sessionId;
	ws.isAlive = true;
	ws.on('pong', function() {

		console.log('heartbeat detected')
	  	ws.isAlive = true;
	});

    ws.on('error', function(error) {
        console.log('Connection ' + sessionId + ' error');
        stop(channelId, sessionId);
    });

    ws.on('close', function() {
        console.log('Connection ' + sessionId + ' closed');
        stop(channelId, sessionId);
    });

    ws.on('message', function(_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ');

        switch (message.id) {

        // login for presenters
        case 'auth':

        	if (isAuthenticated(qs)) {
        		ws.send(JSON.stringify({ authenticated: true }))
	        	break;
        	}

        	ws.send(JSON.stringify({ authenticated: false }))
    		break;

        case 'presenter':
			startPresenter(qs, sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
				if (error) {
					return ws.send(JSON.stringify({
						id : 'presenterResponse',
						response : 'rejected',
						message : error
					}));
				}
				ws.send(JSON.stringify({
					id : 'presenterResponse',
					response : 'accepted',
					sdpAnswer : sdpAnswer
				}));
			});
			break;

        case 'viewer':
			startViewer(channelId, sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
				if (error) {
					return ws.send(JSON.stringify({
						id : 'viewerResponse',
						response : 'rejected',
						message : error
					}));
				}

				ws.send(JSON.stringify({
					id : 'viewerResponse',
					response : 'accepted',
					sdpAnswer : sdpAnswer
				}));
			});
			break;

        case 'stop':
            stop(channelId, sessionId);
            break;

        case 'onIceCandidate':
            onIceCandidate(channelId, sessionId, message.candidate);
            break;

        case 'getChannelStatus':
        	getChannelStatus(channelId, sessionId, ws);
        	break;

        case 'bootChannel':
	        console.log('bootChannel');
        	bootChannel(qs, channelId, sessionId, function(error, response) {
        		if (error) {
        			console.log('bootChannelResponse error')
        			return ws.send(JSON.stringify({
						id : 'bootChannelResponse',
						response : 'rejected',
						message : error
					}));
        		}

        		ws.send(JSON.stringify({
					id : 'bootChannelResponse',
					response : 'accepted',
				}));


        	});
        	break;

        default:
            ws.send(JSON.stringify({
                id : 'error',
                message : 'Invalid message ' + message
            }));
            break;
        }
    });
});

/*
 * Definition of functions
 */


// 
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {

    var channelId = ws.channelId;
    var sessionId = ws.sessionId;

	// ws.send(JSON.stringify({
	//     id : 'channelStatus',
	//     message : channelStatus(channelId)
	// }));

  	

    if (ws.isAlive === false) {
	    // clean up channelStatusSubscribers if not alive

	    console.log('cleanup ws', channelId, sessionId)
	    if (channelStatusSubscribers[channelId] && channelStatusSubscribers[channelId][sessionId] ) {
	    	delete channelStatusSubscribers[channelId][sessionId]
	    }
    	return ws.terminate();
    }

    // ws.isAlive = false;
    // ws.ping(noop);


  });
}, 3000);

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function(error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                    + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}


function bootChannel(qs, channelId, sessionId, callback) {
	// kick all users out of channel

	var channelId = qs.channel
	var pkey = qs.pkey

	if (!isAuthenticated(qs)) {
		return callback("bad pkey")
	}

	// when user has authority, start kicking out user
	return stopChannel(channelId)



}

function getChannelStatus(channelId, sessionId, ws) {
	console.log('getChannelStatus', channelId, sessionId)

	// subscribe user to channelStatusSubscribers
	var statusSub = channelStatusSubscribers[channelId]

	if (!statusSub) {
		statusSub = []
	}
	
	statusSub[sessionId] = {
		'ws': ws,
	}


	ws.send(JSON.stringify({
	    id : 'channelStatus',
	    message : channelStatus(channelId)
	}));

	// update channel status
	channelStatusSubscribers[channelId] = statusSub

	console.log('update channel status', channelStatusSubscribers[channelId].length)

}

function startPresenter(qs, sessionId, ws, sdpOffer, callback) {
	clearCandidatesQueue(sessionId);

	// console.log('startPresenter', qs)

	var channelId = qs.channel
	var pkey = qs.pkey

	if (!isAuthenticated(qs)) {
		return callback("bad pkey")
	}

	// current presenter in channel
	var presenter = presenters[channelId]

	if (presenter && presenter !== null) {
		stop(channelId, sessionId);
		return callback("Another user is currently acting as presenter. Try again later ...");
	}


	presenters[channelId] = {
		id : sessionId,
		pipeline : null,
		webRtcEndpoint : null,
		ws: ws,
	}

	presenter = presenters[channelId]

	getKurentoClient(function(error, kurentoClient) {
		if (error) {
			stop(channelId, sessionId);
			return callback(error);
		}

		if (!presenter || presenter === null) {
			stop(channelId, sessionId);
			return callback(noPresenterMessage);
		}

		kurentoClient.create('MediaPipeline', function(error, pipeline) {
			if (error) {
				stop(channelId, sessionId);
				return callback(error);
			}

			if (!presenter || presenter === null) {
				stop(channelId, sessionId);
				return callback(noPresenterMessage);
			}

			presenter.pipeline = pipeline;
			pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
				if (error) {
					stop(channelId, sessionId);
					return callback(error);
				}

				if (!presenter || presenter === null) {
					stop(channelId, sessionId);
					return callback(noPresenterMessage);
				}

				presenter.webRtcEndpoint = webRtcEndpoint;

                if (candidatesQueue[sessionId]) {
                    while(candidatesQueue[sessionId].length) {
                        var candidate = candidatesQueue[sessionId].shift();
                        webRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                webRtcEndpoint.on('OnIceCandidate', function(event) {
                    var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    ws.send(JSON.stringify({
                        id : 'iceCandidate',
                        candidate : candidate
                    }));
                });

				webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
					if (error) {
						stop(channelId, sessionId);
						return callback(error);
					}

					if (!presenter || presenter === null) {
						stop(channelId, sessionId);
						return callback(noPresenterMessage);
					}

					callback(null, sdpAnswer);
				});

                webRtcEndpoint.gatherCandidates(function(error) {
                    if (error) {
                        stop(channelId, sessionId);
                        return callback(error);
                    }
                });

                broadcastChannelStatus(channelId);









            });
        });
	});
}


function broadcastChannelStatus(channelId) {

    // notify status indicators that presenter is live
    if (!channelStatusSubscribers[channelId]) {
        channelStatusSubscribers[channelId] = []
    }

    console.log('notify channelStatusSubscribers length:', channelId, channelStatusSubscribers[channelId].length, channelStatus(channelId))

    var channelStatusMsg = channelStatus(channelId)

    for (var i in channelStatusSubscribers[channelId]) {

    	var subscriber = channelStatusSubscribers[channelId][i]

    	if (subscriber.ws) {

    		if (subscriber.ws.readyState === ws.CLOSED) return

    		subscriber.ws.send(JSON.stringify({
			    id : 'channelStatus',
			    message : channelStatusMsg,
			}));
    	}
		
    }

}

function startViewer(channelId, sessionId, ws, sdpOffer, callback) {
	clearCandidatesQueue(sessionId);

	var presenter = presenters[channelId]

	if (!presenter || presenter === null) {
		stop(channelId, sessionId);
		return callback(noPresenterMessage);
	}

	presenter.pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
		if (error) {
			stop(channelId, sessionId);
			return callback(error);
		}

		if (!viewersByChannel[channelId]) {
			viewersByChannel[channelId] = {}
		}

		viewersByChannel[channelId][sessionId] = {
			"webRtcEndpoint" : webRtcEndpoint,
			"ws" : ws
		}


		if (!presenter || presenter === null) {
			// console.log('no presenter present')
			stop(channelId, sessionId);
			return callback(noPresenterMessage);
		}

		if (candidatesQueue[sessionId]) {
			while(candidatesQueue[sessionId].length) {
				var candidate = candidatesQueue[sessionId].shift();
				webRtcEndpoint.addIceCandidate(candidate);
			}
		}

        webRtcEndpoint.on('OnIceCandidate', function(event) {
            var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
            ws.send(JSON.stringify({
                id : 'iceCandidate',
                candidate : candidate
            }));
        });

		webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
			if (error) {
				stop(channelId, sessionId);
				return callback(error);
			}
			if (!presenter || presenter === null) {
				stop(channelId, sessionId);
				return callback(noPresenterMessage);
			}

			presenter.webRtcEndpoint.connect(webRtcEndpoint, function(error) {
				if (error) {
					stop(channelId, sessionId);
					return callback(error);
				}
				if (!presenter || presenter === null) {
					stop(channelId, sessionId);
					return callback(noPresenterMessage);
				}

				callback(null, sdpAnswer);
		        webRtcEndpoint.gatherCandidates(function(error) {
		            if (error) {
			            stop(channelId, sessionId);
			            return callback(error);
		            }
		        });
		    });
	    });
	});
}

function clearCandidatesQueue(sessionId) {
	if (candidatesQueue[sessionId]) {
		delete candidatesQueue[sessionId];
	}
}


function stopChannel(channelId) {
	// stop channel without checking for channelid
	var presenter = presenters[channelId]
	var viewers = viewersByChannel[channelId]

	if (presenter && presenter !== null) {

		
		if (presenter.ws) {
			presenter.ws.send(JSON.stringify({
				id : 'stopCommunication'
			}));
		}

		for (var i in viewers) {
			console.log('stopChannel presenter stopping, clearing viewers', i)
			var viewer = viewers[i];
			if (viewer.ws) {
				viewer.ws.send(JSON.stringify({
					id : 'stopCommunication'
				}));
			}
		}

		presenter.pipeline.release();
		presenter = null;

		// remove presenter from server
		delete presenters[channelId]
		delete viewersByChannel[channelId]

		// tell status indicators that there is no longer a presenter
		broadcastChannelStatus(channelId)
	}

	// update viewersByChannel
	viewersByChannel[channelId] = viewers

}


function stop(channelId, sessionId) {

	var presenter = presenters[channelId]
	var viewers = viewersByChannel[channelId]

	if (presenter && presenter !== null && presenter.id == sessionId) {

		

		for (var i in viewers) {
			console.log('presenter stopping, clearing viewers', i)
			var viewer = viewers[i];
			if (viewer.ws) {
				viewer.ws.send(JSON.stringify({
					id : 'stopCommunication'
				}));
			}
		}

		presenter.pipeline.release();
		presenter = null;

		// remove presenter from server
		delete presenters[channelId]
		delete viewersByChannel[channelId]

		// tell status indicators that there is no longer a presenter
		broadcastChannelStatus(channelId)


	} else if (viewers && viewers[sessionId]) {
		// if the user is a viewer as well, then they should remove 
		viewers[sessionId].webRtcEndpoint.release();
		delete viewers[sessionId];
		viewersByChannel[channelId] = viewers

	}


	clearCandidatesQueue(sessionId);

	if (viewers && viewers.length < 1 && !presenter && kurentoClient ) {
        console.log('Closing kurento client');
        kurentoClient.close();
        kurentoClient = null;
    }

	// update viewersByChannel
	viewersByChannel[channelId] = viewers
}

function onIceCandidate(channelId, sessionId, _candidate) {

	var presenter = presenters[channelId]
	var viewers = viewersByChannel[channelId]

    var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (presenter && presenter.id === sessionId && presenter.webRtcEndpoint) {
        console.info('Sending presenter candidate');
        presenter.webRtcEndpoint.addIceCandidate(candidate);
    }
    else if (viewers && viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
        console.info('Sending viewer candidate');
        viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }

	// update viewersByChannel
	viewersByChannel[channelId] = viewers
}


function channelStatus(channelId) {
	// returns a json with channel info
	var mediaConstraints;
	if (presenterKeys[channelId]) {
		mediaConstraints = presenterKeys[channelId].mediaConstraints
	}

	if (presenters[channelId]) {
		return {
			"channel": channelId, 
			"isPresenting": true,
			mediaConstraints: mediaConstraints,

		}
	}

	return {
		"channel": channelId, 
		"isPresenting": false,
		mediaConstraints: mediaConstraints,
	};
}

app.use(
	express.static(path.join(__dirname, 'static'))




	// '/bla',
	// function(req,res){
	// 	// var id = req.params.id;
		
	// 	//further operations to perform

	//     var id = req.query.id;
	//     // res.end("I have received the ID: " + id);
	//     console.info('id', id);
	// }

);

console.log('__dirname', path.join(__dirname, 'static'))

// REST endpoint to indicate channel activity status

presenterKeys = {
	'BMCC': {
		name: 'BMCC',
		key: '789',
		mediaConstraints: {
			video: {},
			audio: true,
		},
	},
	'BMCC-English': {
		name: 'BMCC English',
		key: '789',
		mediaConstraints: {
			video: false,
			audio: true,
		},
	},
	'BMCC-Mandarin':{
		name: 'BMCC Mandarin',
		key: '123',
		mediaConstraints: {
			video: false,
			audio: true,
		},
	},
}

app.get('/poo/:channel', function(req, res) {
	var channel = req.params.channel


	if (presenters[channel]) {
		res.json({"channel": channel, "isPresenting": true });
	}

	return res.json({"channel": channel, "isPresenting": false});

}) 

// // Endpoint to indicate channel auth key

// app.get('/poo/:channel', function(req, res) {
// 	var channel = req.params.channel

// 	if (presenters[channel]) {
// 		res.json({"channel": channel, "isPresenting": true});
// 	}

// 	return res.json({"channel": channel, "isPresenting": false});

// }) 
