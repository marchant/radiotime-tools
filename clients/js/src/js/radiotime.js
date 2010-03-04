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
		
		if (opts.player) { 
			this.addPlayer(opts.player);
		}

		this._initKeys();
		this._initEventHandlers();
		
		var supportedPlayer = false;
		if (!opts.noPlayer) {
			for (var i = 0; i< RadioTime._players.length; i++) { 
				if (supportedPlayer = RadioTime._players[i].isSupported()) {
					RadioTime.merge(RadioTime.player, RadioTime._players[i].implementation);
					break;
				}
			};
		}
		if (supportedPlayer) {
			this.player.init(this._container);
			this.formats = RadioTime.player.formats;
			RadioTime.debug("Using player: " + this.player.playerName);
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
		
		// We don't need accurate time immediately so postpone it a bit 
		// to give room for UI to load
		setTimeout(function(){
			RadioTime._syncTime();
		}, 3*1000);
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
		VK_PLAY: 190, //	"."
		VK_STOP: 188, //	","
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
			state = parseInt(state);
			if (isNaN(state))
				return;
			if (!RadioTime.player.states[state])
				return;
			RadioTime.player.currentState = RadioTime.player.states[state];
			
			switch (RadioTime.player.currentState) {
				case "playing":
				case "buffering": 
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
		var now = new Date();
		this.timeCorrection = 0;
		this.gmtOffset = -now.getTimezoneOffset();
		
		var _this = this;
		
		RadioTime.API.getTime(function(data){
			RadioTime.debug("Got accurate time");
			data = data[0];
			RadioTime.debug(data);
			_this.gmtOffset = parseInt(data.detected_offset);
			_this.tzName = data.detected_tz;
			_this.timeCorrection = parseInt(data.utc_time)*1000 - (+new Date());
			RadioTime.debug("adjusted gmtOffset = " + _this.gmtOffset + " minutes");
			RadioTime.debug("timeCorrection = " + _this.timeCorrection + " milliseconds");
			RadioTime.debug("Time sync took " + ((+new Date()) - (+now)) + " ms");
			
		});	
		
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
				return;
			if (this._currentItem < this._playlist.length - 1) {
				this._currentItem++;
				this.play();
			} else {
				RadioTime.event.raise("playlistEnded");
			}		
		},
		play: function(url) {
			if (url) {
				this._playlist = [{"url":url}];
				this._currentItem = 0;
			}
			var newUrl = "";
			if (this._playlist) {
				newUrl = this._playlist[this._currentItem].url;
				
			}
			// Don't stop unless the URL is different
			if (newUrl != this._url) {
				this.stop();
				this._url = newUrl;
			}
			if (!this._url) {
				return;
			}
			this._play(this._url);
		},
		isSupported: function() {
			return true;
			return ( //hack to add iphone support via quicktime by skipping flash
				//FIXME: make player detection not need this.  :-)
				typeof RadioTime.player._player != "undefined" && 
				(RadioTime.player._player.doStop || RadioTime.player._player.play)
			);
		}
	},
	addPlayer: function(player) {
		this._players.unshift([function() { return true; }, player]);
	},
	_players: [
		{
			isSupported: function() { 
				return navigator.userAgent.match(/CE-HTML/); 
			},
			implementation: { 
				init: function(container) {
					this.playerName = "ce";
					this.formats = ["mp3", "flash"];
					var d = document.createElement("div");
					this._id = RadioTime.makeId();
					d.innerHTML = '<object id="' + this._id + '" type="audio/mpeg"></object>';
					container.appendChild(d);
					this._player = RadioTime.$(this._id);
				},
				_play: function(url){
					if (!this._player || !this._player.play) 
						return;
					this._player.data = this._url;
					this._player.play(1);
					var _this = this;
					this._player.onPlayStateChange = function() {
						//jgd//RadioTime.debug(_this._player.playState);
						if (5 == _this._player.playState) {
							RadioTime.player.next();
						}
						RadioTime.event.raise("playstateChanged", _this._player.playState);
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
					this._player.play();
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
					RadioTime.event.raise("playstateChanged", RadioTime.player.states[1]);
				},
				stop: function() {
					songbird.stop();
					RadioTime.event.raise("playstateChanged", RadioTime.player.states[0]);
				},
				pause: function() {
					songbird.pause();
					RadioTime.event.raise("playstateChanged", RadioTime.player.states[2]);
				},
				states: {
					0:  "stopped", 
					1:  "playing", 
					2:  "paused"
				}
			}				
		},
		{
			isSupported: function() { return true }, //FIXME: detect whether flash player is really available.
	 		implementation:
	 		{
				init: function(container) {
					this.playerName = 'flash';
					this.formats = ["mp3", "flash"];
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
					//this._player = RadioTime.$(this._id);
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
								RadioTime.event.raise("playstateChanged", RadioTime.player.states[params.arg]);
								break;
							case "progress":
							case "position":
							case "nowplaying":
								break;	
							case "ready":
								RadioTime.debug("flash object is ready");
								break;
						}
						if (params.command != "position")
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
				states: {
					5:  "finished", 
					0:  "unknown", 
					1:  "stopped", 
					2:  "connecting", 
					3:  "playing",
					4:  "error"
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
		init: function(guide_id) {
			var _this = this;
			
			this.stopUpdates();
			this._fetch(guide_id);
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
					_this.fetch(_this.guide_id);
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
				start: this.schedule[this.nowPlayingIndex].start,
				end: this.schedule[this.nowPlayingIndex].end
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
		if (url.indexOf("partnerId") < 0 && data.indexOf("partnerId") < 0) {
			url += "partnerId=" + RadioTime._partnerId + "&";
		}
		if (url.indexOf("username") < 0 && url.indexOf("serial") < 0 && data.indexOf("serial") < 0) {
			url += "serial=" + RadioTime._serial + "&";
		}
		if (!needAuth && RadioTime.formats && url.indexOf("formats") < 0 && data.indexOf("formats") < 0) {
			url += "formats=" + RadioTime.formats.join(",") + "&";
		}
		if (RadioTime.latlon && url.indexOf("latlon") < 0 && data.indexOf("latlon") < 0) {
			url += "latlon=" + RadioTime.latlon + "&";
		}
		if (!needAuth && RadioTime.locale && url.indexOf("locale") < 0 && data.indexOf("locale") < 0) {
			url += "locale=" + RadioTime.locale + "&";
		}
		if (-1 == url.indexOf("render=json")) {
			url += "render=json&";
		}
		return {"url": url, "data": data};
	},	
	loadJSON: function(url, onsuccess, onfailure) {
		url = RadioTime._formatReq(url);
		RadioTime.debug("API request: " + url.url);
		RadioTime._loader.sendRequest(url, function(data) {
			var status = (data.head && data.head.status) ? data.head.status : "missing";
			if (status == "200") { // Status is not returned for Register.aspx call
				if (data && onsuccess) {
					onsuccess.call(this, data.body, data.head);
				}
			} else {
				if (onfailure) onfailure.call(null, data.head);
			}
			RadioTime.event.raise("loaded");
			}, function() {
				if (onfailure) onfailure.call(null);
				RadioTime.event.raise("failed", url);
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
			RadioTime.loadJSON("Browse.ashx?c=" + category, success, failure);
		},
		getRootMenu: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading_menu');
			RadioTime.loadJSON("Browse.ashx", success, failure);
		},
		getStationSchedule: function(success, failure, id){ //TODO (SDK) - add optional time range.
			var startDate = RadioTime.now();
			var stopDate = RadioTime.now();
			stopDate.setTime(startDate.getTime() + 1000 * 60 * 60 * 24);
			startDate.setTime(startDate.getTime() - 1000 * 60 * 60 * 24);
			
			//FIXME: seems we should either autodetect (as here) or use offset (as RT getTime above), but not both.
			var url = "Browse.ashx?c=schedule&id=" + id + "&start=" + RadioTime._dateToYYYYMMDD(startDate) +
			"&stop=" + RadioTime._dateToYYYYMMDD(stopDate) + "&autodetect=true";// + "&offset=" + RadioTime.gmtOffset;
			
			RadioTime.event.raise("loading", 'status_loading_schedule');
			RadioTime.loadJSON(url, function(data) {
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
				success.call(this, data);
			}, failure);
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
			RadioTime.loadJSON("Browse.ashx?id=" + id, success, failure);
		},
		addPreset: function(success, failure, id) {
			RadioTime.event.raise("loading", 'status_adding_preset');
			var url = RadioTime._formatReq("Preset.ashx?c=add&id=" + id, true);
			RadioTime.loadJSON(url, success, failure)
		},
		removePreset: function(success, failure, id) {
			RadioTime.event.raise("loading", 'status_removing_preset');
			var url = RadioTime._formatReq("Preset.ashx?c=remove&id=" + id, true);
			RadioTime.loadJSON(url, success, failure)
		},
		search: function(success, failure, query, filter) {
			RadioTime.event.raise("loading", 'status_searching');
			var url = RadioTime._formatReq("Search.ashx?query=" + query + "&filter=" + filter);
			RadioTime.loadJSON(url, success, failure)
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
					var u = RadioTime._formatReq("Register.aspx");
					RadioTime.loadJSON(u, function(data){
						var out = {
							"hasAccount": false,
							"text": data[0].text
						}
						success.call(this, out);
					}, failure);
			});
		}, 
		getLocalStrings: function(success, failure) {
			RadioTime.event.raise("loading", 'status_loading');
			var url = RadioTime._formatReq("Config.ashx?c=contentQuery");
			RadioTime.loadJSON(url, function(data) {
				RadioTime._applyLocalStrings(data);
				success(data);
			}, failure);
		},
		getTime: function(success, failure) {
			RadioTime.event.raise("loading", 'status_sync_time');
			var url = RadioTime._formatReq("Config.ashx?c=time");
			RadioTime.loadJSON(url, success, failure)
		}
	},
	response: {
		audio: function (body) { 
			var out = [];
			RadioTime._walk(body, 
				function(elem) { 
					if (elem.element == "outline" && elem.type == "audio") {
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
		_requestTimeout: 30, // in seconds
		requests: {},
		sendRequest: function(req, success, failure, retries) {
			if (typeof req != 'number') { // this is a new request
				var reqId = RadioTime.makeId();
					
				this.requests[reqId] = {
					_req: req,
					_requestCompleted: false,
					_callback: success != undefined ? success : null,
					_failure: failure != undefined ? failure : null,
					_retries: retries != undefined ? retries : 0,
					_reqUrl: (req.url.indexOf("callback=") < 0) ? req.url + "callback=RadioTime._loader.requests[" + reqId + "].init" : req.url,
					init: function(data) {
						this._requestCompleted = true;
						if (this._callback) {
							this._callback.call(this, data);
						}
					},
					fail: function() {
						if (this._failure) {
							this._failure.call(this);
						}
					}
				};
			} else {
				var reqId = req;
				if (this.requests[reqId] == undefined)
					return;
				// OK
				if (this.requests[reqId]._requestCompleted) {
					this.clearRequest(reqId);
					return;
				}
				// No retries left?
				if (this.requests[reqId]._retries <= 0) {
					this.onerror(this.requests[reqId]);
					this.clearRequest(reqId);
					return;
				}
				this.requests[reqId]._retries--;
			}	
			if (RadioTime.$(reqId)) {
				RadioTime.$(reqId).parentNode.removeChild(RadioTime.$(reqId));
			}
			var s;
			var _this = this;
			if (this.requests[reqId]._callback) { 
				s = document.createElement("script");
				s.onload = function() {

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
			
			setTimeout(function() {
				_this.sendRequest(reqId);
			}, this._requestTimeout*1000);
		},
		clearRequest: function(reqId) {
			if (RadioTime.$(reqId)) {
				RadioTime.$(reqId).parentNode.removeChild(RadioTime.$(reqId));
				delete this.requests[reqId];
			} else {
				if (this.requests[reqId] && !this.requests[reqId]._requestCompleted) {
					var _this = this;
					this.requests[reqId].init = function(data){
						RadioTime.debug("Late request arrived: " + reqId);
						_this.clearRequest(reqId);
					}
				}
			}
		},
		onerror: function(req) {
			req.fail();
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
