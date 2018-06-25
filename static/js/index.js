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

// gets query string
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
})(window.location.search.substr(1).split('&'));

var ws = new WebSocket('wss://' + location.host + '/one2many?channel=' + qs.channel + '&pkey=' + qs.pkey);
var video;
var webRtcPeer;
var channel = qs.channel
var pkey = qs.pkey

var isPresenting = false;

var mediaConstraints;


// var allFacingModes = ['user', 'environment']
var isUserfacingMode =  false



function initViewerMode() {
	// document.getElementById('call').style.display = 'none';
	// document.getElementById('terminate').style.display = 'none';
	// document.getElementById('switch-camera').style.display = 'none';

	// document.getElementById('viewer').style.display = 'table-cell';

	console.log('init viewer mode')

	document.getElementById('status-online').innerHTML = "Status: Streaming live. Click Viewer to begin"
	document.getElementById('status-offline').innerHTML = "Status: Offline. No one is presenting now"

	$('.btn-group-presenter').hide()
	$('.btn-group-viewer').show()


}



//  switchCamera (for presenting via phone)
function switchCamera(event) {
	// body...

  // var constraints = {
  //   video: true,
  //   audio: true
  // };

  if (isPresenting) {
  	return window.alert('Stop the stream first before switching cameras.')
  }

  isUserfacingMode = !isUserfacingMode

  return



  // var constraints = { audio: true, video: { facingMode: { exact: "user" } } };

  // navigator.mediaDevices
  //   .getUserMedia(constraints)
  //   .then(function(stream) {
  //     video.srcObject = stream;
  //   })
  //   .catch(function(error) {
  //     console.error(error);
  //   });


}

// $( document ).ready(function() {


$( document ).ready(function() {
	// console = new Console();
	video = document.getElementById('video');

	// var str = jQuery.param( params );
	// console.log('poooooo', qs)

	// if user intends to be a viewer
	if (!qs.pkey) {
		initViewerMode()
	}

	
	document.getElementById('channel-name').innerHTML = qs.channel;

	document.getElementById('call').addEventListener('click', function() { presenter(); } );
	document.getElementById('viewer').addEventListener('click', function() { viewer(); } );
	document.getElementById('terminate').addEventListener('click', function() { stop(); } );
	document.getElementById('switch-camera').addEventListener('click', function() { switchCamera(); } );

	// document.getElementById('boot-channel').addEventListener('click', function() { bootChannel(); } );






});

window.onbeforeunload = function() {
	ws.close();
}

ws.onopen = function() {

	// when ready, seek channel status
	channelStatus()

}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ', message.data);

	switch (parsedMessage.id) {
	case 'channelStatus':
		channelStatusResponse(parsedMessage);
		break;
	case 'bootChannelResponse':
		bootChannelResponse(parsedMessage);
		break;
	case 'presenterResponse':
		presenterResponse(parsedMessage);
		break;
	case 'viewerResponse':
		viewerResponse(parsedMessage);
		break;
	case 'stopCommunication':
		dispose();
		break;
	case 'iceCandidate':
		webRtcPeer.addIceCandidate(parsedMessage.candidate)
		break;
	default:
		console.error('Unrecognized message', parsedMessage);
	}
}

function onError(error) {
	console.error(error)
}

function channelStatus() {
	var message = {
		id : 'getChannelStatus'
	}
	sendMessage(message);

}

function bootChannel() {
	// function to remove current presenter and all viewers
	var message = {
		id : 'bootChannel'
	}
	sendMessage(message);

}

function bootChannelResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknown error';
		return checkPkey(errorMsg)
	}

	// if it is accepted, channel would be reset, nothing will need to be done.

}

function channelStatusResponse(message) {
	console.log('channelStatusResponse', message)
	isPresenting = message.message.isPresenting;
	mediaConstraints = message.message.mediaConstraints;

	// document.getElementById('status').innerHTML = isPresenting ? 'Online...': 'Offline'

	document.getElementById('status-online').style.display = isPresenting ? "block" : "none";
	document.getElementById('status-offline').style.display = isPresenting ? "none" : "block";

}

function checkPkey(message){
	// if message comes back to 'bad pkey, reinit user to viewer mode'
	if (message == 'bad pkey') {
			window.alert("Your presenter link has expired. Contact your IT administrator for a new link!")
			initViewerMode()
	}
}


function presenterResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknown error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		checkPkey(errorMsg)
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}

function viewerResponse(message) {
	if (message.response != 'accepted') {
		var errorMsg = message.message ? message.message : 'Unknown error';
		console.warn('Call not accepted for the following reason: ' + errorMsg);
		console.log(message)
		dispose();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer);
	}
}


function presenter() {
	if (!webRtcPeer) {
		showSpinner(video);

		var options = {
			localVideo: video,
			onicecandidate : onIceCandidate,
			mediaConstraints: mediaConstraints,
	    }

	    if (mediaConstraints.video) {
	    	mediaConstraints.video = { facingMode: isUserfacingMode ? "user" : "environment" } 
	    }

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(error) {
			if(error) return onError(error);

			this.generateOffer(onOfferPresenter);
		});

	}
}

function onOfferPresenter(error, offerSdp) {
    if (error) return onError(error);

	var message = {
		id : 'presenter',
		channel: channel,
		sdpOffer : offerSdp
	};
	sendMessage(message);
}

function viewer() {
	if (!webRtcPeer) {
		showSpinner(video);

		var options = {
			remoteVideo: video,
			onicecandidate : onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(error) {
			if(error) return onError(error);

			this.generateOffer(onOfferViewer);
		});
	}
}

function onOfferViewer(error, offerSdp) {
	if (error) return onError(error)

	var message = {
		id : 'viewer',
		channel: channel,
		sdpOffer : offerSdp
	}
	sendMessage(message);
}

function onIceCandidate(candidate) {
	   console.log('Local candidate' + JSON.stringify(candidate));

	   var message = {
	      id : 'onIceCandidate',
	      channel: channel,
	      candidate : candidate
	   }
	   sendMessage(message);
}

function stop() {
	if (webRtcPeer) {
		var message = {
				id : 'stop'
		}
		sendMessage(message);
		dispose();
		return
	}

	if (isPresenting && qs.pkey) {
		bootChannel()
		return
	}
}

function dispose() {
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;
	}
	hideSpinner(video);
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner_fancy.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
