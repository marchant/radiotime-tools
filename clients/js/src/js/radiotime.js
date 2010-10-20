/**
 * radiotime.js -- API, helper functions and objects
 * 
 * @author alex
 * @author Jeremy Dunck <jeremy@radiotime.com>
 * 
 * 
 */
var RadioTime = {
	_baseUrls: {
		"stable": "opml.radiotime.com/",
		"beta": "dev.radiotime.com/opml/",
		"dev": "localhost:55084/opml/"
	},
	init: function(partnerId, containerId, path, opts) {
		this._partnerId = partnerId;
		this._container = document.getElementById(containerId);
		this._path = path;
		this._serial = this.cookie.read("radiotime_serial");
		if (!this._serial) {
			this._serial = this.makeId();
			this.cookie.save("radiotime_serial", this._serial, 365*10);
		}
		
		opts = opts || {};
		
		this._env = (opts.env && this._baseUrls[opts.env]) ? opts.env: "stable";

		this._baseUrl = this._baseUrls[this._env];
		this._verbose = opts.verbose;
		this._useAMPM = opts.useAMPM !== undefined ? opts.useAMPM: true;
		this._enableEvents = opts.enableEvents !== undefined ? opts.enableEvents: true;
		this.latlon = opts.latlon;
		this.includePlaylists = opts.includePlaylists;
		this._exactLocation = opts.exactLocation;
		this._username = opts.username;
		this._password = opts.password;
		this._useCache = opts.useCache;
		
		if (opts.player) { 
			this.addPlayer(opts.player);
		}

		this._initKeys();
		this._initEventHandlers();
		
		this._activePlayers = [];

		if (!opts.noPlayer) {
			for (var i = 0; i< RadioTime._players.length; i++) { 
				if (RadioTime._players[i].isSupported()) {
					var p = RadioTime._players[i].implementation;
					p.init(this._container); 
					this._activePlayers.push(p);
				}
			};
		}
		if (this._activePlayers.length > 0) {
			RadioTime.activePlayer = this._activePlayers[0]; // for a quick test only
			// Collect supported formats from all active players 
			this.formats = [];
			var f, fj;
			
			for (var i = 0; i < this._activePlayers.length; i++) {
				f = this._activePlayers[i].formats;
				for (var j = 0; j < f.length; j++) {
					fj = f[j];
					// mp3raw is not a valid format so should be replaced with mp3
					fj = (fj == "mp3raw") ? "mp3" : fj;
					if (!RadioTime._inArray(this.formats, fj)) {
						this.formats.push(fj);
					}
				}
			}
		} else {
			if (!opts.noPlayer) {
				alert("Unable to find a supported audio player");
				RadioTime.formats = opts.formats ? opts.formats : ["mp3","wma"];
			} else {
				RadioTime.formats = ["mp3", "wma"];
			}
		};
		
		this.history = this._histories[opts['history'] || 'internal'];
		this.history._init(opts['onHistoryChange']);
		
		this.timeCorrection = 0;
		this.gmtOffset = -(new Date()).getTimezoneOffset();
	},
	_addScript: function(url, onload) {
		var head = document.getElementsByTagName('head')[0];
		var script = document.createElement('script');
		script.setAttribute('src', url);
		script.onload = function() {
			head.removeChild(script);
			onload();
		}
		head.appendChild(script);
	},
	/* Platform key contants
	 * need to define these so that it won't break while testing in a browser 
	 * also it provides a nice way to emulate
	 */
	_keys: { //TODO (SDK): map CE keys into private space rather than browser keys into global space.
		VK_0: 48,
		VK_1: 49,
		VK_2: 50,
		VK_3: 51,
		VK_4: 52,
		VK_5: 53,
		VK_6: 54,
		VK_7: 55,
		VK_8: 56,
		VK_9: 57,	
		VK_ENTER: 13,
		VK_UP: 38,
		VK_DOWN: 40,
		VK_LEFT: 37,
		VK_RIGHT: 39,
		VK_BACK: 27,
		VK_BACK_SPACE: 8,
		VK_PLAY: 120, //	"F9"
		VK_STOP: 121, //	"F10"
		VK_PAUSE: 191  //	"/"															
	},
	_initKeys: function() {
		for (var key in this._keys) {
			if (typeof window[key] == "undefined") {
				window[key] = this._keys[key];
			}
		}
	},
	_initEventHandlers: function() {
		RadioTime.event.subscribe("playstateChanged", function(state) {
			RadioTime.player.currentState = state;
			
			switch (RadioTime.player.currentState) {
				case "playing":
				case "buffering": 
				case "starting":
				case "connecting":
					RadioTime.player.isBusy = true;
					break;
				default:
					RadioTime.player.isBusy = false;
					break;	
			}
		});		
	},
	_syncTime: function(){
		var _this = this;
		RadioTime.API.getTime(function(data){
			_this._onTime(data);
		});	
	},
	_onTime: function(data) {
		RadioTime.debug("Got accurate time");
		data = data[0];
		RadioTime.debug(data);
		this.gmtOffset = parseInt(data.detected_offset);
		this.tzName = data.detected_tz;
		this.timeCorrection = parseInt(data.utc_time)*1000 - (+new Date());
	},
	player: {
		startPlaylist: function(playlist) {
			if (!playlist || !playlist.length)
				return;
			this._playlist = playlist;
			this._currentItem = 0;
			this.play();
		},
		next: function() {
			if (!this._playlist || !this._playlist.length)
				return false;
			if (this._currentItem < this._playlist.length - 1) {
				this._currentItem++;
				this.play();
				return true;
			} else {
				RadioTime.event.raise("playlistEnded");
				return false;
			}		
		},
		play: function(url) {
			if (url) {
				this._playlist = [{"url":url}];
				this._currentItem = 0;
			}
			var newUrl = "", newPlayer = null;
			if (this._playlist) {
				newUrl = this._playlist[this._currentItem].url;
				newPlayer = this.pickPlayer(this._playlist[this._currentItem]);
			}
			// Don't stop unless the URL is different
			if (newUrl != this._url && newPlayer) {
				this.stop();
				this._url = newUrl;
				RadioTime.activePlayer = newPlayer;
				RadioTime.debug("Using player: " + RadioTime.activePlayer.playerName);
			}
			if (!this._url) {
				return;
			}
			try {
				RadioTime.activePlayer._play(this._url);
			} catch (e) {
				RadioTime.debug(e.message);
			}
		},
		pickPlayer: function(data) {
			var res = null;
			if (this.isSupported()){
				res = RadioTime._activePlayers[0]; // default choice
			}
			for (var i = 0; i < RadioTime._activePlayers.length; i++) {
				// Convert is_direct into pseudotype "mp3raw"
				if (data.media_type == "mp3" && data.is_direct) {
					data.media_type = "mp3raw";
				}
				if (data.media_type && 
				RadioTime._inArray(RadioTime._activePlayers[i].formats, data.media_type)) {
					res = RadioTime._activePlayers[i];
					break;
				}
			}
			return res;
		},
		stop: function() {
			try {
				RadioTime.activePlayer.stop();
			} catch (e) {
				RadioTime.debug(e.message);
			}
		},
		pause: function() {
			try {
				RadioTime.activePlayer.pause();
			} catch (e) {
				RadioTime.debug(e.message);
			}
		},
		/**
		 * setVolume -- Sets playback volume if supported by the current player
		 * @param {Number} volume -- Volume level in %. Valid values are 0 to 100
		 */
		setVolume: function(volume){
			if (typeof RadioTime.activePlayer["setVolume"] != "undefined") {
				RadioTime.activePlayer.setVolume(volume);
			} else {
				RadioTime.debug("setVolume is not supported by the current player");
			}
		},
		getVolume: function() {
			if (typeof RadioTime.activePlayer["getVolume"] != "undefined") {
				return RadioTime.activePlayer.getVolume();
			} else {
				return -1;
			}
		},
		isSupported: function() {
			return RadioTime._activePlayers.length > 0;
		}
	},
	addPlayer: function(player) {
		this._players.unshift([function() { return true; }, player]);
	},
	_players: [
		{
			/*
			 * CE-HTML player
			 */
			isSupported: function() { 
				return navigator.userAgent.match(/CE-HTML/); 
			},
			implementation: { 
				init: function(container) {
					this.playerName = "ce";
					this.formats = ["mp3raw"];
					var d = document.createElement("div");
					this._id = RadioTime.makeId();
					d.innerHTML = '<object id="' + this._id + '" type="audio/mpeg"></object>';
					container.appendChild(d);
					this._player = RadioTime.$(this._id);
				},
				_play: function(url){
					if (!this._player || !this._player.play) 
						return;
					this._player.data = url;
					this._player.play(1);
					var _this = this;
					this._player.onPlayStateChange = function() {
						if (5 == _this._player.playState) {
							RadioTime.player.next();
						}
						RadioTime.event.raise("playstateChanged", _this.states[_this._player.playState]);
					}
				},
				stop: function() {
					if (!this._player || !this._player.stop) 
						return;
					this._player.stop();
				},
				pause: function() {
					if (!this._player || !this._player.play) 
						return;
					this._player.play(); // this actually means 'pause' on CE!
				},
		
				states: {
					5:  "finished", 
					0:  "stopped", 
					6:  "error", 
					1:  "playing", 
					2:  "paused", 
					3:  "connecting",
					4:  "buffering"
				}			
			}
		},
		{
			/*
			 * Songbird player
			 */
			isSupported: function() { return window.songbird; },
			implementation: { //FIXME: need to integrate more to do eventing based on player transitions.
				//	var listener = { observe: function(subject, topic, data) {...}}; songbird.addListener("faceplate.playing", listener)
				init: function () {
					this.playerName = 'songbird';
					this.formats = ["mp3"];
					songbird.setSiteScope("", "");
					this.library = songbird.siteLibrary;
				},
				_play: function (url) {
					//FIXME: it'd be nice to resume from pause (because it's faster), 
					//  but that would mean juggling state w/ the host player (it could be paused on a local Library song)
					
					//FIXME: switch to createMediaListFromURL? :-/
					songbird.playURL(url);
					//FIXME: need mediacore listener to sync w/ real state:
					RadioTime.event.raise("playstateChanged", this.states[1]);
				},
				stop: function() {
					songbird.stop();
					RadioTime.event.raise("playstateChanged", this.states[0]);
				},
				pause: function() {
					songbird.pause();
					RadioTime.event.raise("playstateChanged", this.states[2]);
				},
				states: {
					0:  "stopped", 
					1:  "playing", 
					2:  "paused"
				}
			}				
		}, {
			/*
			 * Flash player ActionScript 3.0 version
			 * Used for flash (rtmp) streams
			 */
			isSupported: function() { 
				var f = "-", n = navigator;
				if (n.plugins && n.plugins.length) {
					for (var ii=0; ii<n.plugins.length; ii++) {
						if (n.plugins[ii].name.indexOf('Shockwave Flash') != -1) {
							f = n.plugins[ii].description.split('Shockwave Flash ')[1];
							break;
						}
					}
				} else if (window.ActiveXObject) {
					for (var ii=10; ii>=2; ii--) {
						try {
							var fl = eval("new ActiveXObject('ShockwaveFlash.ShockwaveFlash." + ii + "');");
							if (fl) { 
								f = ii + '.0'; 
								break; 
							}
						}
						catch(e) {}
					}
				}
				if (f != "-") {
					RadioTime.debug("Flash " + f + " detected");
				}
				if (f.split(".")[0]) {
					f = f.split(".")[0];
				}
				return (f > 8);
			},
	 		implementation:
	 		{
				init: function(container) {
					this.playerName = 'flash';
					this.formats = ["flash"];
					var d = document.createElement("div");
					container.appendChild(d);
					d.style.position = "absolute";
					this._id = RadioTime.makeId();
					var flashvars = '"autostart=true&objectid=' + this._id + '"';
					if (/MSIE/.test(navigator.userAgent)) { // IE detection ~[-1]
						d.innerHTML = '<object id="' + this._id + '" classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" width="1" height="1"><param name="allowScriptAccess" value="always" /><param name="movie" value="' + RadioTime._path + 'swf/mplayer.swf?' + this._id + '" /><param name="flashvars" value=' + flashvars + '/></object>';
					} else {
						d.innerHTML = '<embed id="' + this._id + '" type="application/x-shockwave-flash" width="1" height="1" src="' + RadioTime._path + 'swf/mplayer.swf?' + this._id + '" allowscriptaccess="always"  flashvars=' + flashvars + '/>';
					}
					container.innerHTML;
					this._player = d.firstChild;

					var _this = this;
					RadioTime.event.subscribe("flashEvent", function(params) {
						if (_this._id != params.objectid)
							return;
						switch (params.command) {
							case "status":
								if (5 == parseInt(params.arg)) {
									RadioTime.debug("player next");
									RadioTime.player.next();
								}
								RadioTime.debug("flashEvent status", params.arg);
								RadioTime.event.raise("playstateChanged", _this.states[params.arg]);
								break;
							case "progress":
							case "position":
							case "nowplaying":
								break;	
							case "ready":
								RadioTime.debug("flash object is ready");
								break;
						}
						if (params.command != "position" && params.command != "progress")
							RadioTime.debug(params);
					});
				},
				_play: function(url) {
					if (!this._player || !this._player.playDirectUrl) 
						return;
					this._player.playDirectUrl(url);
				},
				stop: function() {
					if (!this._player || !this._player.doStop) 
						return;
					this._player.doStop();
				},
				pause: function() {
					if (!this._player || !this._player.doPause) 
						return;
					this._player.doPause();
				},
				setVolume: function(volume) {
					this._volume = volume;
					this._player.setVolume(volume);
				},
				getVolume: function() {
					return this._volume;
				},
				states: {
					5:  "finished", 
					0:  "unknown", 
					1:  "stopped", 
					2:  "connecting", 
					3:  "playing",
					4:  "error"
				}	
			}
		},{
			/*
			 * Flash player ActionScript 2.0 version
			 * Used for mp3 streams
			 */
			isSupported: function() { 
				var f = "-", n = navigator;
				if (n.plugins && n.plugins.length) {
					for (var ii=0; ii<n.plugins.length; ii++) {
						if (n.plugins[ii].name.indexOf('Shockwave Flash') != -1) {
							f = n.plugins[ii].description.split('Shockwave Flash ')[1];
							break;
						}
					}
				} else if (window.ActiveXObject) {
					for (var ii=10; ii>=2; ii--) {
						try {
							var fl = eval("new ActiveXObject('ShockwaveFlash.ShockwaveFlash." + ii + "');");
							if (fl) { 
								f = ii + '.0'; 
								break; 
							}
						}
						catch(e) {}
					}
				}
				if (f != "-") {
					RadioTime.debug("Flash " + f + " detected");
				}
				if (f.split(".")[0]) {
					f = f.split(".")[0];
				}
				return (f > 6);
			},
	 		implementation:
	 		{
				init: function(container) {
					this.playerName = 'flashAS2';
					this.formats = ["mp3raw"];
					var d = document.createElement("div");
					container.appendChild(d);
					d.style.position = "absolute";
					this._id = RadioTime.makeId();
					var flashvars = '"autostart=true&objectid=' + this._id + '"';
					if (/MSIE/.test(navigator.userAgent)) { // IE detection ~[-1]
						d.innerHTML = '<object id="' + this._id + '" classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" width="1" height="1"><param name="allowScriptAccess" value="always" /><param name="movie" value="' + RadioTime._path + 'swf/mplayer-AS2.swf?' + this._id + '" /><param name="flashvars" value=' + flashvars + '/></object>';
					} else {
						d.innerHTML = '<embed id="' + this._id + '" type="application/x-shockwave-flash" width="1" height="1" src="' + RadioTime._path + 'swf/mplayer-AS2.swf?' + this._id + '" allowscriptaccess="always"  flashvars=' + flashvars + '/>';
					}
					container.innerHTML;
					this._player = d.firstChild;

					var _this = this;
					RadioTime.event.subscribe("flashEvent", function(params) {
						if (_this._id != params.objectid)
							return;
						switch (params.command) {
							case "status":
								if (5 == parseInt(params.arg)) {
									RadioTime.debug("player next");
									RadioTime.player.next();
								}
								RadioTime.debug("flashEvent status", params.arg);
								RadioTime.event.raise("playstateChanged", _this.states[params.arg]);
								break;
							case "progress":
							case "position":
							case "nowplaying":
								break;	
							case "ready":
								RadioTime.debug("flash object is ready");
								break;
						}
						if (params.command != "position" && params.command != "progress")
							RadioTime.debug(params);
					});
				},
				_play: function(url) {
					if (!this._player || !this._player.playDirectUrl) 
						return;
					this._player.playDirectUrl(url);
				},
				stop: function() {
					if (!this._player || !this._player.doStop) 
						return;
					this._player.doStop();
				},
				pause: function() {
					if (!this._player || !this._player.doPause) 
						return;
					this._player.doPause();
				},
				setVolume: function(volume) {
					this._volume = volume;
					this._player.setVolume(volume);
				},
				getVolume: function() {
					return this._volume;
				},
				states: {
					5:  "finished", 
					0:  "unknown", 
					1:  "stopped", 
					2:  "connecting", 
					3:  "playing",
					4:  "error"
				}	
			}
		},{			
			/*
			 * WMP player
			 */
			isSupported: function() { 
				var n = navigator, s = false;
				if (n.userAgent.match(/chrome/)) {
					if (RadioTime.isTypeSupported("application/x-ms-wmp")) {
						s = true;
					}
				} else	if (n.plugins && n.plugins.length) {
					for (var ii=0; ii<n.plugins.length; ii++) {
						if (n.plugins[ii].name.indexOf('Windows Media Player') != -1 || n.plugins[ii].name.indexOf('Windows Media') != -1) {
							if (RadioTime.isTypeSupported("application/x-ms-wmp")) {
								s = true;
							}
							break;
						}
					}
				} else if (window.ActiveXObject) {
					try {
						var wmp = new ActiveXObject("WMPlayer.OCX.7");	
						var f = wmp.versionInfo;
						s = true;
						delete wmp;
					}
					catch(e) {
						s = false;
					}
				}
				if (s) {
					RadioTime.debug("Windows Media Player detected");
				}
				return s;
			},	
	 		implementation:
	 		{
				init: function(container) {
					this.playerName = 'wmp';
					this.formats = ["wma", "wmpro", "wmvoice", "mp3", "mp3raw"];
					var object = null;
					try	{
						if (window.ActiveXObject){
							object = new ActiveXObject("WMPlayer.OCX.7");
						} else if (window.GeckoActiveXObject){
							object = new GeckoActiveXObject("WMPlayer.OCX.7");
						}
					} catch(e) {
						object = null;
					}
					
					var d = document.createElement("div");
					container.appendChild(d);
					d.style.position = "absolute";
					this._id = RadioTime.makeId();

					if (!object) {
						d.innerHTML = '<embed width="1" height="1" id="' + this._id + '" type="application/x-ms-wmp"></embed>';
					} else {
						delete object;
						d.innerHTML = '<object classid="CLSID:6BF52A52-394A-11d3-B153-00C04F79FAA6" width="1" height="1" id="' + this._id + '"></object>';
					}
					container.innerHTML;
					this._player = d.firstChild;
					
					var _this = this;
					window["OnDSErrorEvt"] = function() {
						RadioTime.debug("WMP error occured");
						_this._error = true;
						RadioTime.event.raise("playstateChanged", "error");
					}

					window["OnDSPlayStateChangeEvt"] = function(newstate) {
						if (newstate == 8) { // Media Ended
							RadioTime.player.next();
						}
						if (newstate == 10 && _this._error){
							_this._error = false;
							RadioTime.debug("WMP 'State 10' condition");
						}
						RadioTime.debug("WMP state: " + newstate);
						RadioTime.event.raise("playstateChanged", _this.states[newstate]);
					}

				},
				_play: function(url) {
					if (!this._player) 
						return;
					this._player.URL = url;
					this._player.controls.play();
				},
				stop: function() {
					if (!this._player) 
						return;
					this._player.controls.stop();
				},
				pause: function() {
					if (!this._player) 
						return;
					this._player.controls.pause();
				},
				setVolume: function(volume) {
					if (!this._player) 
						return;
					this._player.settings.volume = volume;
				},
				getVolume: function() {
					if (!this._player) 
						return;
					return this._player.settings.volume;
				},
/*	
 * WMP playState codes reference
 * 			
	0	Undefined	Windows Media Player is in an undefined state.
	1	Stopped	Playback of the current media item is stopped.
	2	Paused	Playback of the current media item is paused. When a media item is paused, resuming playback begins from the same location.
	3	Playing	The current media item is playing.
	4	ScanForward	The current media item is fast forwarding.
	5	ScanReverse	The current media item is fast rewinding.
	6	Buffering	The current media item is getting additional data from the server.
	7	Waiting	Connection is established, but the server is not sending data. Waiting for session to begin.
	8	MediaEnded	Media item has completed playback.
	9	Transitioning	Preparing new media item.
	10	Ready	Ready to begin playing.
	11	Reconnecting	Reconnecting to stream.		
*/		
				states: {
					1:  "stopped", 
					0:  "unknown", 
					8:  "ended", 
					2: 	"paused",
					4:  "connecting", 
					5:  "connecting",
					6:  "connecting", 
					7:  "connecting", 
					9:  "connecting",
					11: "connecting",
					3:  "playing",
					10: "stopped"
				}	
			}
		},{
			/*
			 * HTML5 player
			 */
			isSupported: function() { 
				// iPad-only for now
				return /iPad/i.test(navigator.userAgent); 
			},
			implementation: {
				init: function(container){
					this.playerName = "html5";
					this.formats = ["mp3", "mp3raw", "aac"];
					var d = new Audio();
					this._id = RadioTime.makeId();
					d.id = this._id;
					container.appendChild(d);
					this._player = RadioTime.$(this._id);
					var _this = this;
					/*
					 * <audio> event handlers
					 */
					this._player.addEventListener('error', function(){
						_this._stateChanged('error');
					}, true);
					this._player.addEventListener('playing', function(){
						_this._stateChanged('playing');
					}, true);
					this._player.addEventListener('pause', function(){
						_this._stateChanged('pause');
					}, true);
					this._player.addEventListener('ended', function(){
						_this._stateChanged('ended');
						RadioTime.player.next();
					}, true);
					this._player.addEventListener('abort', function(){
						_this._stateChanged('abort');
					}, true);
					this._player.addEventListener('loadstart', function(){
						_this._stateChanged('loadstart');
					}, true);
					this._player.addEventListener('seeking', function(){
						_this._stateChanged('seeking');
					}, true);
					this._player.addEventListener('waiting', function(){
						_this._stateChanged('waiting');
					}, true);
					this._player.addEventListener('suspend', function(){
						_this._stateChanged('suspend');
					}, true);
					this._player.addEventListener('stalled', function(){
						_this._stateChanged('stalled');
					}, true);
				},
				_stateChanged: function(newstate){
					var state = "stopped";
					switch (newstate) {
						case "pause":
							state = "paused";
							break;
						case "stalled":
						case "suspend":
						case "ended":
						case "stopped":
							state = "stopped";
							break;
						case "playing":
							state = "playing";
							break;
						case "loadstart":
						case "waiting":
						case "seeking":
							state = "connecting";
							break;
						case "error":
							state = "error";
							break;
					}
					RadioTime.debug("html5 state: " + newstate);
					RadioTime.event.raise("playstateChanged", this.states[state]);
				},
				_play: function(url){
					if (this._player.src != url) {
						this._player.src = url;
						this._player.load();
					}
					this._player.play();
				},
				stop: function(){
					this._player.pause();
				},
				pause: function(){
					this._player.pause();
				},
				setVolume: function(volume) {
					this._player.volume = volume/100.0;
				},
				getVolume: function() {
					return Math.round(100*this._player.volume);
				},
				states: {
					"finished": "finished",
					"stopped": "stopped",
					"error": "error",
					"playing": "playing",
					"paused": "paused",
					"connecting": "connecting"
				}
			}		
		},{
			/*
			 * Silverlight player
			 */
			isSupported: function() { 
				var f = "-", a = null, AgControl = null;
				var plugin = navigator.plugins["Silverlight Plug-In"];
				try
			    {
				 	if (plugin) {
						a = document.createElement("div");
						document.body.appendChild(a);
						if(navigator.userAgent.match(/applewebkit/))
							a.innerHTML = '<embed type="application/x-silverlight" />';
						else 
							a.innerHTML = '<object type="application/x-silverlight"  data="data:," />';
						AgControl = a.childNodes[0];
				 	} else if (window.ActiveXObject) {
				            var AgControl = new ActiveXObject("AgControl.AgControl");
				    }
					document.body.innerHTML;
					f = AgControl.IsVersionSupported("2.0") ? "2.0" : (AgControl.IsVersionSupported("1.0") ? "1.0" : "-");
					delete AgControl;
				} catch (e){
			        f = "-";
			
					if (plugin && plugin.description) {
						var ver = plugin.description.split(".");
						if (isFinite(ver[0]) && isFinite(ver[1])) {
			
							if (ver[0] > 0) {
								f = ver[0] + "." + ver[1];
							}
						}
					}
			    }
				if (a) document.body.removeChild(a);
				if (f != "-") {
					RadioTime.debug("Silverlight " + f + " detected");
					return true;
				} else {
					return false;
				}
			},	
	 		implementation:
	 		{
				init: function(container) {
					this.playerName = 'silverlight';
					this.formats = ["wma", "wmpro", "wmvoice", "mp3raw"];
					var x = document.createElement("script");
					x.type = "text/xaml";
					x.id = 'x' + RadioTime.makeId();
					var xaml = '<?xml version="1.0"?><Canvas xmlns="http://schemas.microsoft.com/client/2007" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><MediaElement x:Name="media" AutoPlay="true" Width="1" Height="1"/></Canvas>';
					if (navigator.userAgent.match(/msie/i)) {
						x.text = xaml;
					} else {
						x.appendChild(document.createTextNode(xaml)); // doesn't work in IE
					}
					container.appendChild(x);

					var d = document.createElement("div");
					container.appendChild(d);
					d.style.position = "absolute";
					this._id = RadioTime.makeId();

					if (navigator.userAgent.match(/applewebkit/i)) {
						d.innerHTML = '<embed type="application/x-silverlight" id="' + this._id + '" width="1" height="1" source="#' + x.id + '" onError="__slError_rt" onLoad="__slLoad_rt"/>';
					} else {
						d.innerHTML = '<object type="application/x-silverlight" id="' + this._id + '" width="1" height="1"  data="data:,"><param name="source" value="#' + x.id + '"/><param name="onError" value="__slError_rt"/><param name="onLoad" value="__slLoad_rt"/></object>';
					}
					container.innerHTML;
					this._player = d.firstChild;
					
					var _this = this;
					window["__slError_rt"] = function(s, a) {
						RadioTime.debug("Silverlight error: " + a.errorMessage);
						_this._error = true;
						RadioTime.event.raise("playstateChanged", "error");
					}
					window["__slLoad_rt"] = function(s, a) {
						RadioTime.debug("Silverlight is ready");
						_this.__player = _this._player.content.findName("media");
						_this.__player.AddEventListener("CurrentStateChanged", function(){
							var cs = _this.__player.CurrentState;
							RadioTime.debug("Silverlight state: " + cs);
							// Keep it from erasing error state immediately
							if (_this._error && cs == "Closed") {
								_this._error = false;
								return;
							} 
							RadioTime.event.raise("playstateChanged", _this.states[cs]);
						});
					}
				},
				_play: function(url) {
					if (!this.__player) 
						return;
					this.__player.Source = url;
					this.__player.Play();
				},
				stop: function() {
					if (!this.__player) 
						return;
					this.__player.Stop();
				},
				pause: function() {
					if (!this.__player) 
						return;
					if (this.__player.CanPause) {
						this.__player.Pause();
					} else {
						this.__player.Stop();
					}
				},
				setVolume: function(volume) {
					this._player.Volume = volume/100.0;
				},
				getVolume: function() {
					return Math.round(100*this._player.Volume);
				},
				states: {
					"Closed":  "stopped", 
					"Unknown":  "unknown", 
					"Stopped":  "stopped", 
					"Paused": "paused",
					"Buffering":  "connecting", 
					"Opening":  "connecting", 
					"Playing":  "playing",
					"Error":  "error"
				}	
			}
		}
	],
	schedule: {
		_tickInterval: 1, 	// seconds between Now playing progress updates
		_tickReg: null, //non-null if progress is running
		_fetchInterval: 10, 	// seconds between Next on updates
		_fetchReg: null,   //non-null if fetch is running
		schedule: null,
		nowPlayingIndex: -1,
		guide_id: null,
		init: function(guide_id, schedule) {
			var _this = this;
			this.stopUpdates();
			if (!schedule) {
				this._fetch(guide_id);
			} else {
				this.lastUpdate = RadioTime.now();
				this.guide_id = guide_id;
				this._available(schedule);
			}
		},
		_fetch: function(guide_id) {
			RadioTime.debug("fetch with " + guide_id);
			if (!guide_id) return;
			if (this.lastUpdate && this.lastUpdate.getHours && this.lastUpdate.getHours() == RadioTime.now().getHours()){
				this._available(this.schedule);
				return;
			}
			var _this = this;
			RadioTime.debug("RadioTime.API.getStationSchedule with " + guide_id);
			RadioTime.API.getStationSchedule(function(data){
				_this.guide_id = guide_id;
				_this._available(data);
			}, function() { RadioTime.debug("Failed to get schedule") }, guide_id);
			this.lastUpdate = RadioTime.now();
		},
		/*
		 * Pre-process schedule
		 */
		_available: function(data) {
			if (!data) return;
			this.schedule = data;
			var now = RadioTime.now();
			var _this = this;

			var oldNowPlayingIndex = (typeof this.nowPlayingIndex != "undefined") ? this.nowPlayingIndex : -2;
			this.nowPlayingIndex = -1;

			for (var i = 0; i < data.length; i++) {
				// Skip the past
				if (data[i].end < now.getTime()) {
					continue;
				}

				// This is what playing now
				if (data[i].start < now.getTime() && data[i].end > now.getTime()) {
					this.nowPlayingIndex = i;
					data[i].is_playing = true;
					if (this._tickReg) {
						clearInterval(this._tickReg);
					}
					this._tickReg = setInterval(function(){
						_this._tick();
					}, this._tickInterval*1000);
					continue;
				} else {
					data[i].is_playing = false;
				}
			}
			if (this._fetchReg) {
				clearTimeout(this._fetchReg);
			}
			if (this.nowPlayingIndex < 0) { // Nothing is playing
				this._fetchReg = setTimeout(function(){
					_this._fetch(_this.guide_id);
				}, this._fetchInterval*1000);
			}
			if (this.nowPlayingIndex != oldNowPlayingIndex) {
				RadioTime.event.raise("schedule", data);
			}
		},
		_tick: function() {
			if (this.nowPlayingIndex < 0 || !this.schedule || !this.schedule[this.nowPlayingIndex]) {
				return;
			}
			RadioTime.event.raise("scheduleProgress", {
				guide_id: this.guide_id,
				item: this.schedule[this.nowPlayingIndex]
			});
			if (this.schedule[this.nowPlayingIndex].end < RadioTime.now().getTime()) {
				this._available(this.schedule);
			};
		},
		stopUpdates: function() {
			if (this._tickReg) {
				clearInterval(this._tickReg);
			}
			if (this._fetchReg) {
				clearTimeout(this._fetchReg);
			}
			this.lastUpdate = null;
			this.nowPlayingIndex = null;
			this.guide_id = null;
		}
	},
	logoSizes: {"square": "q", "small": "s", "normal": ""}, 
	logoFormats: {"png":"png","gif":"gif"},
	getLogoUrl: function(guide_id, logoSize, logoFormat) {
		var logoSizeCode = RadioTime.logoSizes[logoSize] || "";
		var logoFormat = RadioTime.logoFormats[logoFormat] || "png";
		return "http://radiotime-logos.s3.amazonaws.com/" + guide_id + logoSizeCode + "." + logoFormat;
	},
	getReportProblemUrl: function(guide_id) {
		return "Report.ashx?c=wizard&id=" + guide_id;
	},
	_formatReq: function(url, needAuth, data) {
		// Prepare the URL
		data = data || "";
		// Avoid formatting it twice
		if (url.url) {
			return url;
		}
		if (url.indexOf("http") < 0) { // default request path
			url = (needAuth ? "https://" : "http://") + RadioTime._baseUrl + url;
		}
		url += (url.indexOf("?")!=-1 ? "&" : "?");

		if (url.indexOf("username") < 0 && this._username !== undefined) {
			url += "username=" + this._username + "&";
		}
		if (needAuth && url.indexOf("password") < 0 && this._password !== undefined) {
			url += "password=" + this._password + "&";
		}
		if (url.indexOf("partnerId") < 0 && data.indexOf("partnerId") < 0) {
			url += "partnerId=" + RadioTime._partnerId + "&";
		}
		if (url.indexOf("username") < 0 && url.indexOf("serial") < 0 && data.indexOf("serial") < 0) {
			url += "serial=" + RadioTime._serial + "&";
		}
		if (!needAuth && RadioTime.formats && url.indexOf("formats") < 0 && data.indexOf("formats") < 0) {
			url += "formats=" + RadioTime.formats.join(",") + "&";
		}
		if (!needAuth && !RadioTime.includePlaylists && url.indexOf("playlists") < 0 && data.indexOf("playlists") < 0) {
			url += "playlists=none&";
		}
		if (RadioTime.latlon && url.indexOf("latlon") < 0 && data.indexOf("latlon") < 0) {
			url += "latlon=" + RadioTime.latlon + "&";
			if (RadioTime._exactLocation && url.indexOf("exact") < 0 && data.indexOf("exact") < 0) {
				url += "exact=1&"
			}
		}
		if (!needAuth && RadioTime.locale && url.indexOf("locale") < 0 && data.indexOf("locale") < 0) {
			url += "locale=" + RadioTime.locale + "&";
		}
		if (-1 == url.indexOf("render=json")) {
			url += "render=json&";
		}
		return {"url": url, "data": data};
	},	
	loadJSON: function(url, onsuccess, onfailure, cacheTTL) {
		var originalUrl = url;
		url = RadioTime._formatReq(url);
		var _url = url.url;
		RadioTime.debug("API request: " + originalUrl);
		if (RadioTime._useCache && cacheTTL) {
			var cached = RadioTime.cache.get(originalUrl);
			if (cached && onsuccess) {
				RadioTime.debug("Returning result from cache");
				onsuccess.call(this, cached.body, cached.head);
				RadioTime.event.raise("loaded");
				return;
			}
		}
		RadioTime._loader.sendRequest(url, function(data) {
			var status = (data.head && data.head.status) ? data.head.status : "missing";
			if (status == "200") { // Status is not returned for Register.aspx call
				if (data && onsuccess) {
					if (RadioTime._useCache && cacheTTL){
						RadioTime.cache.add(originalUrl, data, cacheTTL);
					}
					onsuccess.call(this, data.body, data.head);
				}
			} else {
				RadioTime.event.raise("failed", "Bad response: " + _url);
				if (onfailure) onfailure.call(this, data.head);
			}
			RadioTime.event.raise("loaded");
		}, function() {
			RadioTime.event.raise("failed", "Timeout: " + _url);
			if (onfailure) {
				onfailure.call(this);
			}
		});
	},
	_getIdType: function(guideId) {
		if (!guideId) return "unknown";
		
		switch (guideId.charAt(0)) {
			case "p":
				return "program";
			case "s":
				return "station";
			case "g":
				return "group";
			case "t":
				return "topic";
			case "c":
				return "category";
			case "r":
				return "region";
			case "f":
				return "podcast_category"; //???
			case "a":
				return "affiliate";
			case "e":
				return "stream";
			default:
				return "unknown";
		}
	},
	now: function() {
		return (
			new Date(
						(+new Date()) +
						this.timeCorrection +
						(this.gmtOffset + (new Date()).getTimezoneOffset())*60*1000
				)
			);
	},
	_dateToYYYYMMDD: function(date) {
		var out = '';
		out += date.getFullYear();
		var mon = date.getMonth() + 1;
		out += (mon < 10) ? "0" + mon : mon;
		var dat = date.getDate();
		out += (dat < 10) ? "0" + dat : dat;
		return out;
	},
	formatTime: function(time) {
		if (typeof time != "object") {
			var ts = time;
			time = RadioTime.now();
			time.setTime(ts);
		}
		var out = '';
		if (RadioTime._useAMPM) {
			var hours = time.getHours();
			var suffix = "am";
			switch (true) {
				case (hours == 0) :
					hours = 12;
					suffix = "am";
					break;
				case (hours == 12):
					suffix = "pm";
					break;
				case (hours > 12):
					suffix = "pm";
					hours -= 12
					break
				default:
					break;
			}
			out = (hours + 0.01*time.getMinutes()).toFixed(2).replace(".", ":") + suffix;
		} else {
			out = (time.getHours() + 0.01*time.getMinutes()).toFixed(2).replace(".", ":");
		}
		return out.replace(/^(\d):/, '0$1:');
	},
	_dateFromServicesString: function(dateString) {
		var out = new Date(dateString.replace("T", " ").replace(/-/g, "/"));
		out.setTime(out.getTime());
		return out;
	},
	_calculateEndTime: function(startTime, duration /*seconds*/) {
		var endTime = RadioTime.now();
		if (isNaN(startTime)) startTime = startTime.getTime();
		endTime.setTime(startTime + duration*1000);
		return endTime;
	},	
	processSchedule: function(data){
		var now = RadioTime.now().getTime();
		// Pre-process the data
		for (var i = 0; i < data.length; i++) {
			data[i].start = RadioTime._dateFromServicesString(data[i].start).getTime();
			data[i].end = RadioTime._calculateEndTime(data[i].start, data[i].duration).getTime();
			data[i].is_playing = (data[i].start < now) && (data[i].end > now);
			var str = RadioTime.formatTime(data[i].start);					
			data[i].timeSpanString = str;
			data[i].index = i;
			data[i].oType = RadioTime._getIdType(data[i].guide_id);
		}
		return data;
	},
	_getScheduleRequestParams: function(){
		var startDate = RadioTime.now();
		var stopDate = RadioTime.now();
		stopDate.setTime(startDate.getTime() + 1000 * 60 * 60 * 24);
		startDate.setTime(startDate.getTime() - 1000 * 60 * 60 * 24);
			
		//FIXME: seems we should either autodetect (as here) or use offset (as RT getTime above), but not both.
		var res = "&start=" + RadioTime._dateToYYYYMMDD(startDate) +
			"&stop=" + RadioTime._dateToYYYYMMDD(stopDate) + "&autodetect=true"; // + "&offset=" + RadioTime.gmtOffset;
		return res;
	}, 
	_histories: { //TODO (SDK) switch to hash-tag history system to allow browser back/forward to work.
		"internal": {
			_history: [],
			_equals: function(o1, o2) {
				return (o1.URL == o2.URL);
			},
			_init: function(onHistoryChange) {
				this.onHistoryChange = onHistoryChange;
			},
			back: function() {
				if (this._history.length > 0) {
					this._history.pop();
					this.onHistoryChange(this.last());
					return true;
				} else {
					return false;
				}
			},
			add: function(object){
				RadioTime.debug("history add");
				RadioTime.debug(object);
				//if (!this.history.length || !this._equals(this.last(), object)) {
					object.restorePoint = false;
					this._history.push(object);
				//}
			},
			last: function() {
				RadioTime.debug("history last");
				return (this._history.length > 0) ? this._history[this._history.length - 1] : null;
			},
			reset: function() {
				RadioTime.debug("history clear");
				while(this._history.length > 2) { //FIXME: CE assuming first = home is bad for general SDK apps.
					RadioTime.debug("... back");
					this._history.pop();
				}
			},
			createRestorePoint: function() {
				if (this.last()) {
					this.last().restorePoint = true;
				}
			},
			restore: function() {
				var hasRestorePoint = false;
				for (var i = this._history.length - 1; i >=0; i--) {
					if (this._history[i].restorePoint){
						//this.history[i].restorePoint = false;
						this._history = this._history.slice(0, i + 1);
						break;
					}
				}
				this.onHistoryChange(this.last());
			}
		},
		'hash': { //FIXME: assuming (as RSH does) that the hash is ours to use is bad for multi-widget pages.
			_seq: 0, //used to make a unique hash for browser-based history.
			_restores: {},
			_init: function(onHistoryChange) {
				dhtmlHistory.initialize();
				dhtmlHistory.addListener(function(newLocation, historyData) {
					RadioTime.history._seq = RadioTime.history._parseSequence(newLocation) + 1;
					if (onHistoryChange) {
						onHistoryChange(historyData);
					}
				})
			},
			_makeHash: function(seq) {
				return "history" + seq;
			},
			_parseSequence: function(hash) {
				if (-1 == hash.indexOf("history")) {
					return 0;
				} else {
					return parseInt(hash.replace("history",""));
				}
			},	
			back: function() {
				window.history.back();
			},
			add: function(obj) {
				var hash = this._makeHash(this._seq++);
				dhtmlHistory.add(hash, obj);
			},
			last: function() {
				var key = dhtmlHistory.getCurrentLocation();
				if (historyStorage.hasKey(key)) {
					return historyStorage.get(dhtmlHistory.getCurrentLocation());
				} else {
					return null;
				}
			},
			reset: function() {
				//this._seq = 0;
				//this.restores = {};
				//window.location.hash = "";
			}, //no-op because browser history can handle it (and RSH doesn't have an easy way to clear).
			createRestorePoint: function() {
				if (this._seq > 0) {
					this._restores[this._seq] = true;
				}
			},
			restore: function() {
				var hasRestorePoint = false;
				for (var i = his._seq; i >=0; i--) {
					if (this._restores[i]){
						this._seq = i;
						window.location.hash = "#" + this._seq;
					}
				}
			}
			
		}			
	},
	_inArray: function(a, e) {
		for (var i = 0; i < a.length; i++) {
			if (a[i] == e) return true;
		}
		return false;
	},
	_isArray: function(v) {
		return v && typeof v === 'object' && typeof v.length === 'number' &&
			!(v.propertyIsEnumerable('length'));
	},
	_isString: function(it) {
		return (typeof it == "string" || it instanceof String);
	},
	_hitch: function(scope, method) { //From Dojo Toolkit, returns a function which executes with "this" bound to scope.
		if(_isString(method)){         //more info on why it's needed: http://www.quirksmode.org/js/this.html
			scope = scope || window;
			return function(){ return scope[method].apply(scope, arguments || []); };
		}
		return function(){ return method.apply(scope, arguments || []); };
	},	
	getTuneUrl: function(guideId) {
		return this._formatReq("Tune.ashx?id=" + guideId).url;
	},
	API: {
		getCategory: function(success, failure, category) {
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON("Browse.ashx?c=" + category, success, failure, 60*1000);
		},
		getRootMenu: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading_menu');
			RadioTime.loadJSON("Browse.ashx", success, failure, 60*1000);
		},
		getHomeScreen: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON("Browse.ashx?c=index,best", success, failure, 10*60*1000);
		},
		describeComposite: function(success, failure, guide_id, detail) {
			detail = detail || "options,schedules,listing,affiliates,genres,recommendations";
			var url = "Describe.ashx?id=" + guide_id +"&c=composite&detail=" + detail;
			if (/schedule/.test(detail)){
				url += RadioTime._getScheduleRequestParams();
			}
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON(url, success, failure, 60*1000);
		},
		getStationSchedule: function(success, failure, id){ //TODO (SDK) - add optional time range.
			var url = "Browse.ashx?c=schedule&id=" + id + RadioTime._getScheduleRequestParams();			
			RadioTime.event.raise("loading", 'status_loading_schedule');
			RadioTime.loadJSON(url, function(data) {
				success.call(this, RadioTime.processSchedule(data));
			}, failure, 10*60*1000);
		},
		getProgramListeningOptions: function(success, failure, id) {
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON("Tune.ashx?c=sbrowse&flatten=true&id=" + id, success, failure);
		},
		describe: function(success, failure, id){
			RadioTime.event.raise("loading", 'status_finding_stations');
			RadioTime.loadJSON("Describe.ashx?id=" + id, success, failure);
		},
		tune: function(success, failure, guideId) { 
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON(RadioTime.getTuneUrl(guideId), success, failure);
		},
		getOptions: function(success, failure, id){
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON("Options.ashx?id=" + id, success, failure);
		},
		getRelated: function(success, failure, id){
			RadioTime.event.raise("loading", 'status_loading');
			// No related for topics
			if (RadioTime._getIdType(id) == "topic") {
				if (failure) failure.call(null);
				RadioTime.event.raise("failed", "");
			}
			RadioTime.loadJSON("Browse.ashx?id=" + id, success, failure, 60*60*1000);
		},
		addPreset: function(success, failure, id) {
			RadioTime.event.raise("loading", 'status_adding_preset');
			var url = RadioTime._formatReq("Preset.ashx?c=add&id=" + id, true);
			RadioTime.loadJSON(url, success, failure);
			RadioTime.cache.clear();
		},
		removePreset: function(success, failure, id) {
			RadioTime.event.raise("loading", 'status_removing_preset');
			var url = RadioTime._formatReq("Preset.ashx?c=remove&id=" + id, true);
			RadioTime.loadJSON(url, success, failure);
			RadioTime.cache.clear();
		},
		search: function(success, failure, query, filter) {
			RadioTime.event.raise("loading", 'status_searching');
			RadioTime.loadJSON("Search.ashx?query=" + query + "&filter=" + filter, success, failure, 60*1000);
		},
		getAccountStatus: function(success, failure) {
			RadioTime.event.raise("loading", 'status_checking_account');
			var url = RadioTime._formatReq("Account.ashx?c=query", true);
			RadioTime.loadJSON(url, function(data){
					var out = {
						"hasAccount": true,
						"text": data[0].text
					}
					success.call(this, out);
				}, function(){
					var u = RadioTime._formatReq("Account.ashx?c=claim", true);
					RadioTime.loadJSON(u, function(data){
						var out = {
							"hasAccount": false,
							"text": data[0].text
						}
						success.call(this, out);
					}, failure);
			});
		},
		getConfig: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading_configuration');
			RadioTime.loadJSON("Config.ashx?c=time,contentquery", function(data){
				for (var i = 0; i < data.length; i++) {
					if (data[i].key == "strings") {
						RadioTime._applyLocalStrings(data[i].children);
					} else if (data[i].key == "time") {
						RadioTime._onTime(data[i].children);
					}
				}
				success(data);
			}, failure, 60*60*1000);
		}, 
		getLocalStrings: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading');
			RadioTime.loadJSON("Config.ashx?c=contentQuery", function(data) {
				RadioTime._applyLocalStrings(data);
				success(data);
			}, failure, 60*60*1000);
		},
		getTime: function(success, failure) {
			RadioTime.event.raise("loading", 'status_sync_time');
			RadioTime.loadJSON("Config.ashx?c=time", success, failure)
		},
		submitFeedback: function(success, failure, text, email, id) {
			RadioTime.event.raise("loading", 'sending_message');
			RadioTime.loadJSON("Report.ashx?c=feedback&id=" + id + "&email=" + email + "&text=" + encodeURIComponent(text), success, failure)
		}
	},
	cache: {
		defaultTTL: 30*1000,
		_cache: {},
		clearValue: function(key) {
			if (typeof this._cache[key] != "undefined") {
				delete this._cache[key] ;
			}
		},
		clear: function() {
			this._cache = {};
		},
		add: function(key, value, ttl /*milliseconds*/){
			if (!ttl) {
				ttl = this.defaultTTL;
			}
			this._cache[key] = {
				"data": this._copyJSON(value), 
				"expires": ttl + (+new Date())
			};	
		},
		get: function(key){
			if (typeof this._cache[key] == "undefined") {
				return false;
			}
			if (this._cache[key].expires < (+new Date())){
				return false;
			}
			return this._copyJSON(this._cache[key].data);
		},
		/**
		 * Simple deep copy method, good enough for our data
		 * If you feed object with cyclic reference to it, it will casue stack overflow
		 * @param {Object} json
		 */
		_copyJSON: function(json){
			if (typeof json === "object"){
				if (json === null) {
					return null;
				}
				if (typeof json["length"] !== "undefined"){
					var out = [];
					for (var i = 0; i < json.length; i++) {
						out.push(this._copyJSON(json[i]));
					}
					return out;
				} else {
					var out = {};
					for (var i in json) {
						out[i] = this._copyJSON(json[i]);
					}
					return out;
				}
			} else {
				return json;
			}
		}
	},
	response: {
		audio: function (body) { 
			return this.outline(body, "audio");
		},
		/**
		 * 
		 * @param {Object} body -- services response to process
		 * @param {Object} typeFilter -- could be string (i.e. "audio") or array (i.e. ["audio", "link"])
		 */
		outline: function (body, typeFilter/*optional*/) { 
			var out = [];
			var filter = function(type){
				if (typeof typeFilter === "string"){
					return type === typeFilter;
				}
				if (typeof typeFilter === "object"){
					return RadioTime._inArray(typeFilter, type);
				}
				return true;
			}
			RadioTime._walk(body, 
				function(elem) { 
					if (elem.element == "outline" && filter(elem.type)) {
						out.push(elem);
					}
				}
			);
			return out;
		},
		flatten: function (data, copyKey) {
			var out = [];
			for (var i = 0; i < data.length; i++ ) {
				out.push(data[i]);
				if (data[i].children) {
					if (data[i].key && copyKey) {
						for (var j in data[i].children) {
							data[i].children[j].key = data[i].key;
						}
					}
					out = out.concat(this.flatten(data[i].children, copyKey));
				}
			}
			return out;
		},		
		station: function(body) {
			var out = [];
			var inStationsDepth = -1;
			RadioTime._walk(body, 
				function(elem, depth) {
					if (inStationsDepth > depth) {
						inStationsDepth = -1;
						return
					};
					if (elem.key == 'stations') {
						inStationsDepth = depth + 1;
						return;
					}
					if (inStationsDepth > -1) { 
						out.push(elem);
					} else {
						if (RadioTime._getIdType(elem.guide_id) == "station") {
							out.push(elem);
						}
					}
				}
			);
			return out;
		}
	},
	_walk: function(tree, handler, depth) {
		depth = depth || 0;
		if (RadioTime._isArray(tree)) {
			for (var i=0; i < tree.length; i++) { 
				RadioTime._walk(tree[i], handler, depth);
			}
		} else {
			handler(tree, depth);
			if (tree.children) {
				RadioTime._walk(tree.children, handler, depth + 1);
			}
		}
	},
	_applyLocalStrings: function(locale) {
		var out = {};
		for (var i in locale) {
			out[locale[i].key] = locale[i].value;
		}
		RadioTime.merge(out, RadioTime.localStrings);
		RadioTime.localStrings = out;
		RadioTime.event.raise("localStrings");
	},	
	_loader: {
		_requestTimeout: 10, // in seconds
		requests: {},
		sendRequest: function(req, success, failure, retries) {
			if (typeof this.requests[req] == 'undefined' && req.url) { // this is a new request
				var reqId = 'r' + RadioTime.makeId();
				var _this = this;	
				this.requests[reqId] = {
					_req: req,
					_reqId: reqId,
					_requestCompleted: false,
					_callback: success != undefined ? success : null,
					_failure: failure != undefined ? failure : null,
					_retries: retries != undefined ? retries : 0,
					_reqUrl: (req.url.indexOf("callback=") < 0) ? req.url + "callback=RadioTime._loader.requests." + reqId + ".init" : req.url,
					init: function(data) {
						this._requestCompleted = true;
						if (this._callback) {
							this._callback.call(null, data);
						}
						var rqid = this._reqId;
						setTimeout(function() {
							_this.clearRequest(rqid);
						}, 100);
					},
					fail: function() {
						if (this._failure) {
							this._failure.call(null);
						}
						var rqid = this._reqId;
						setTimeout(function() {
							_this.clearRequest(rqid);
						}, 100);
					}
				};
			} else {
				var reqId = req;
				if (typeof this.requests[reqId] == 'undefined')
					return;

				// No retries left?
				if (this.requests[reqId]._retries <= 0) {
					this.requests[reqId].fail();
					return;
				}
				this.requests[reqId]._retries--;
			}	
			if (RadioTime.$(reqId)) {
				RadioTime.$(reqId).parentNode.removeChild(RadioTime.$(reqId));
			}
			var s;
			if (this.requests[reqId]._callback) { 
				s = document.createElement("script");
				s.onerror = function() {
					_this.requests[reqId].fail();
				}
				
			} else { // use iframe if we don't care about result
				s = document.createElement("iframe");
				s.style.visibility = "hidden";
				s.style.width = "1px";
				s.style.height = "1px";
				s.onload = function() {
					_this.clearRequest(this.id);
				}
			}
			s.id = reqId;
			s.src = this.requests[reqId]._reqUrl;
			RadioTime._container.appendChild(s);
			
			this.requests[reqId]._timeout = setTimeout(function() {
				_this.sendRequest(reqId);
			}, this._requestTimeout*1000);
		},
		clearRequest: function(reqId) {
			if (RadioTime.$(reqId)) {
				RadioTime.$(reqId).onerror = null;
				RadioTime.$(reqId).parentNode.removeChild(RadioTime.$(reqId));
			} 
			if (this.requests[reqId]) {
				
				if (typeof this.requests[reqId]._timeout != "undefined") {
					clearTimeout(this.requests[reqId]._timeout);
					delete this.requests[reqId]._timeout;
				}
				
				delete this.requests[reqId];
			}
		}
	},	
	event: {
		_handlers: [],
		_hid: 0,
		subscribe: function (eventName, handler, forObj) {
			if (!this._handlers[eventName]) {
				this._handlers[eventName] = [];
			}
			var h = {};
			h.func = handler;
			h.forObj = forObj; // if obj is "undefined" then treat handler as default
			h.id = this._hid++;
			this._handlers[eventName].push(h);
			return h.id;
		},
		unsubscribe: function(hid) {
			for (var event_ in this._handlers) {
				for (var handler in this._handlers[event_]) {
					if (this._handlers[event_][handler].id == hid) {
						this._handlers[event_].splice(handler, 1);
						return true;
					}
				}
			}
			return false;
		},
		raise: function(eventName, params, toObj) {
			if (!RadioTime._enableEvents) return true;
			if (!this._handlers[eventName]) {
				//RadioTime.debug("No handlers for " + eventName, "warning")
				return true; 
			}
			var eh = this._handlers[eventName];
			for (handler in eh) {
				if (eh[handler].func && (eh[handler].forObj == toObj || eh[handler].forObj == undefined)) {
					eh[handler].func.call(eh[handler].forObj, params);
				}
			}
		}
	},	
	$: function(name) {
		var el = document.getElementById(name);
		if (!el) {
			RadioTime.debug('Element "',name, '" is not found');
		}
		return el;
	},
	/*
	 * Get localized string
	 */
	L: function(token) {
		return this.localStrings[token] || token;
	},
	localStrings: {},
	debug: function(){
		if (!RadioTime._verbose) return;
		
		if (arguments.length == 1) {
			var txt = arguments[0];
		} else {
			var txt = Array.prototype.slice.call(arguments).join(" ");
		}
		if (window.console && console.debug) {
			console.debug.apply(console, arguments);
		} else if (window.opera && opera.postError) {
			opera.postError.apply(opera, arguments);
		} else {
			// Can't use RadioTime.$ here because it would cause infinite recruision  
			// and stack overflow due to the debug() call in RadioTime.$ 
			if (document.getElementById("radiotime_log")) {
				document.getElementById("radiotime_log").innerHTML += txt + ", ";
			}
		}
	},
	makeId: function() {
		return 1*(Math.random().toString().replace('.', ''));
	},
	_trim: function(s) {
		return s.match(/^\s*(.*?)\s*$/)[1];
	},
	merge: function(target, source, useSuper){
		if (useSuper) {
			target.SUPER = {};
			target.callSuper = function() {
				var function_name = arguments[0];
				[].unshift.call(arguments, this);
				if (typeof this.SUPER[function_name] != "undefined") {
					return this.SUPER[function_name].apply(this, arguments);
				} else {
					return false;
				}
			}
		}
		for (var i in source){
			if (!target[i]) {
				target[i] = source[i];
			} else if (useSuper) {
				target.SUPER[i] = source[i];
			}
		}
	},
	isTypeSupported: function(mimeType) {
		for( var i = 0; i < navigator.mimeTypes.length; i++){
			if(navigator.mimeTypes[i].type.toLowerCase() == mimeType){
				return navigator.mimeTypes[i].enabledPlugin;
			}
		}
		return false;
	},
	cookie: {
		save: function (name, value, days) {
			if (days) {
				var date = new Date();
				date.setTime(date.getTime()+(days*24*60*60*1000));
				var expires = "; expires="+date.toGMTString();
			}
			else var expires = "";
			document.cookie = name+"="+value+expires+"; path=/";
		},
		read: function (name) {
			var nameEQ = name + "=";
			var ca = document.cookie.split(';');
			for(var i=0;i < ca.length;i++) {
				var c = ca[i];
				while (c.charAt(0)==' ') c = c.substring(1,c.length);
				if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
			}
			return null;
		},
		clear: function (name) {
			this.save(name,"",-1);
		}
	},
	/**
	 * This function is called from Flash
	 * @param {Object} command
	 * @param {Object} arg
	 * @param {Object} objectid
	 */
	getUpdate: function(command, arg, objectid) {
		var params ={
			"command": command,
			"arg": arg,
			"objectid": objectid
		}
		RadioTime.event.raise("flashEvent", params);
	}	
}
