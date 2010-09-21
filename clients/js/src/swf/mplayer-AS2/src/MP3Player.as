/**
* ...
* @author DefaultUser (Tools -> Custom Arguments...)
*/
import flash.external.ExternalInterface;

class MP3Player 
{
	private var soundObject:Sound;
	private var restartInterval:Number = 30; //minutes 
	
	private var currentLoaded:Number = 0;
	private var currentPosition:Number = 0;
	private var itemDuration:Number = 0;
	
	private var positionInterval:Number;
	private var loadedInterval:Number;
	private var currentState:Number;
	private var currentVolume:Number = 60;
	private var currentUrl:String = "";
	private var loadingCount:Number = 0;
	private var playlist:Array = [];
	private var currentItem:Number = 0;
	private var lastError:String = "";
	private var wasPlaying:Boolean = false;
	private var isFile:Boolean = false;
	
	public function MP3Player() 
	{
		if(ExternalInterface.available) {
			ExternalInterface.addCallback("playUrl", this, safeStart);
			ExternalInterface.addCallback("playDirectUrl", this, start);
			ExternalInterface.addCallback("doPause", this, pause);
			ExternalInterface.addCallback("setPosition", this, setPosition);
			ExternalInterface.addCallback("getDuration", this, getDuration);
			ExternalInterface.addCallback("doStop", this, stop);
			ExternalInterface.addCallback("doRestart", this, restart);			
			ExternalInterface.addCallback("setVolume", this, setVolume);
			ExternalInterface.addCallback("getLastError", this, getLastError);
			ExternalInterface.addCallback("setRestartInterval", this, setRestartInterval);
		}	
		sendEvent("ready");
		updateState(1);
	}
	public function safeStart(url:String) {
		sendEvent("trace", "safeStart(" + url + ")");
		if (soundObject) { // starting from pause 
			start();
			return;
		}
		updateState(2);
		var parser:PlaylistParser = new PlaylistParser();
		var ref = this;
		var _url = url; 
		sendEvent("safeStart", url);
		parser.load(url, function(res){
			ref.sendEvent("parser", "ok:" + res[0] );
			ref.currentItem = 0;
			ref.playlist = res; 
			ref.start();
		},
		function(err) {
			ref.sendEvent("parser", "error: " + err);
			ref.lastError = err;
			ref.updateState(4);
			//ref.playlist = [_url]; 
			//ref.start();
		});
	}
	public function start(url:String) { 
		sendEvent("trace", "start(" + url + ")");		
		sendEvent("currentItem", currentItem);
		sendEvent("playlist[currentItem]", playlist[currentItem]);
		sendEvent("url", url);
		sendEvent("playlist.length", playlist.length);
		if (url == undefined && currentItem < playlist.length) {
			url = playlist[currentItem];
		}
		if (url == undefined) {
			trace("Error " + currentItem + " " + currentUrl );
			lastError = "Cannot play the stream";
			updateState(4);
			return;
		}
		
		if (!soundObject) {
			var ref = this;
			currentUrl = url;
			soundObject = new Sound();
			soundObject.onSoundComplete = function() {
				ref.tryNext();
			};
			isFile = false;
			soundObject.onLoad = function(scs:Boolean) {
				ref.sendEvent("onLoad: ", scs);
				if (scs == false || ref.soundObject.getDuration() == 0) {
					//ref.tryNext();
					
					if (ref.currentUrl.indexOf(";stream.nsv") < 0 && ref.currentUrl.indexOf("/listen.stream?streamId=") < 0) { // try to handle shoutcast, exclude RadioTime stream proxy URL
						var newUrl:String = ref.currentUrl;
						if (ref.currentUrl.indexOf(".m3u") < 0) {
							newUrl = newUrl.split("listen.pls").join("");
							if (newUrl.substr( -1) != "/")
								newUrl += "/";
							newUrl += ";stream.nsv";						
						} else {
							newUrl = newUrl.slice(0, ref.currentUrl.indexOf(".m3u"));
						}
						

						ref.stop();
						//ref.playlist = [newUrl];
						ref.playlist[ref.currentItem] = newUrl;
						ref.start();	
					} else {
						ref.tryNext();
					}
				}
			};
			soundObject.onID3 = function() {
				ref.isFile = true;
				for (var property in ref.soundObject.id3) {
					trace(property + ":" + ref.soundObject.id3[property]);
				}
				if (ref.soundObject.id3["songname"] != undefined) {
					ref.sendEvent("nowplaying", ref.soundObject.id3["songname"]);
				}
			}
			currentPosition = 0;
			soundObject.loadSound(currentUrl, true);
			soundObject.setVolume(currentVolume);
			sendEvent("progress", 0);
			loadedInterval = setInterval(this, "updateLoaded", 100);
		}
		if (currentState == 3)
			return;
		soundObject.setVolume(currentVolume);
		soundObject.start(currentPosition/1000);
		updatePosition();
		positionInterval = setInterval(this, "updatePosition", 100);
	}
	
	public function stop() {
		sendEvent("trace", "stop()");
		soundObject.stop();
	
		clearInterval(positionInterval);
		clearInterval(loadedInterval);
		currentUrl = "";
		lastError = "";
		//playlist = [];
		//currentItem = 0;
		delete soundObject;
		currentLoaded = 0;
		currentPosition = 0;
		updateState(1);	
	}
	public function restart() {
		sendEvent("trace", "restart()");
		stop();
		start();	
	}
	public function pause() {
		sendEvent("trace", "pause()");
		soundObject.stop();
		clearInterval(positionInterval);
		updateState(1);	
	}
	public function setRestartInterval(i:Number) {
		restartInterval = i;
	}
	public function setPosition(pos:Number) {
		sendEvent("trace", "setPosition(" + pos + ")");
		currentPosition = pos;
		if (soundObject != undefined) {
			//soundObject.setPosition(pos);
			pause();
			start();
		}
	}
	public function getDuration():Number {
		if (soundObject != undefined) {
			return soundObject.duration;
		} else {
			return 0;
		}
	}
	public function setVolume(vol:Number) {
		sendEvent("trace", "setVolume(" + vol + ")");
		currentVolume = vol;
		if (soundObject != undefined) {
			soundObject.setVolume(vol);
		}
	}
	
	public function getLastError() {
		return lastError;
	}
	
	private function updateLoaded() {
		var pct:Number = Math.round(soundObject.getBytesLoaded() / 
			soundObject.getBytesTotal() * 100);
		//trace ("traffic " + soundObject.getBytesLoaded() + " of " + soundObject.getBytesTotal());	
		if(isNaN(pct)) { 
			pct = 0; 
		} else if(pct >= 100) { 
			clearInterval(loadedInterval);
			pct = 100;
		}
		if (pct != currentLoaded) {
			sendEvent("progress", pct); 
			currentLoaded = pct;
		} 
	};

	private function updatePosition() {
		var pos = soundObject.position;
		if (pos > restartInterval * 60 * 1000 && !isFile) {
			sendEvent("trace", "restarting stream on timeout to reset RAM usage");
			restart();
			return;
		}
		//trace("pos " + soundObject.position + " of " + soundObject.duration);

		if (pos == currentPosition) {
			loadingCount++;
			if (loadingCount > 2)
				updateState(2);
		} else { 
			if (!isNaN(soundObject.duration) && soundObject.duration > 0) {
				sendEvent("position", 100 * pos / soundObject.duration);
				wasPlaying = true;
			}
			loadingCount = 0;
			updateState(3);
			currentPosition = pos;
		}
	};

	private function updateState(state:Number) {
		if (currentState != state) {
			currentState = state;
			sendEvent("status", state);			
		}
	}
	
	private function tryNext() {
		sendEvent("trace", "tryNext()");
		if (playlist.length > currentItem) {
			currentItem++; // try next playlist item
			stop();
			start();
		} else {
			if (!wasPlaying) {
				lastError = "No more playlist entries";
				updateState(5);
			} else {
				stop();
			}
		}
	}
/**
 * Unified status codes:
 * 
 * 0 — Unknown (we don't know anything)
 * 1 — Stopped (stream is OK, but not playing now)
 * 2 — Connecting (any operation in progress)
 * 3 — Playing (audio must be heard)
 * 4 — Error (any error occured, stream can't be played)
 * 5 — Ended (any error occured, stream can't be played)
 */	
	private function sendEvent(name, param)	{
		trace(name + ": " + param); 
		if (ExternalInterface.available) {
			ExternalInterface.call("RadioTime.getUpdate", name, param, _root.objectid);
		}
	}

}