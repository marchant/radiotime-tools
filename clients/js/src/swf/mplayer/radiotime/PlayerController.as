package radiotime 
{
	
	/**
	* ...
	* @author alex
	*/
	import flash.external.ExternalInterface;
	
	public class PlayerController 
	{
		public var currentState:Number;
		public var lastError:String = "";
		
		private var objectid:String = "";
		private var player:Object = null;
		private var playlist:Array = [];
		private var currentItem:Number = 0;
		private var currentUrl:String = "";
		
		private var mp3player:MP3Player;
		private var rtmpplayer:FlashPlayer;
				
		public function PlayerController(oid:String = "") 
		{
			if(ExternalInterface.available) {
				ExternalInterface.addCallback("playUrl", safeStart);
				ExternalInterface.addCallback("playDirectUrl", start);
				ExternalInterface.addCallback("doPause", pause);
				ExternalInterface.addCallback("setPosition", setPosition);
				ExternalInterface.addCallback("getDuration", getDuration);
				ExternalInterface.addCallback("doStop", stop);
				ExternalInterface.addCallback("doRestart", restart);			
				ExternalInterface.addCallback("setVolume", setVolume);
				ExternalInterface.addCallback("getLastError", getLastError);
				objectid = oid;
			}	
			mp3player = new MP3Player(this);
			rtmpplayer = new FlashPlayer(this);
			
			player = mp3player;
			
			sendEvent("ready", 0);
			sendEvent("trace", "mplayer3.swf");
			updateState(1);
		}
		public function safeStart(url:String):void {
			sendEvent("trace", "safeStart(" + url + ")");
			if (player.isPaused) { // starting from pause 
				start();
				return;
			}
			updateState(2);
			
			var parser:PlaylistParser = new PlaylistParser();
			
			var ref:PlayerController = this;
			var _url:String = url; 
			sendEvent("safeStart", url);
			parser.load(url, 
				function(res:Array):void {
					ref.sendEvent("parser", "ok:" + res[0] );
					ref.currentItem = 0;
					ref.playlist = res; 
					ref.start();
				},
				function(err:String):void {
					ref.sendEvent("parser", "error: " + err);
					ref.lastError = err;
					ref.updateState(4);
				}
			);
		}		
		public function start(url:String = '' ):void { 
			sendEvent("trace", "start(" + url + ")");		
			sendEvent("currentItem", currentItem);
			sendEvent("playlist[currentItem]", playlist[currentItem]);
			sendEvent("url", url);
			sendEvent("playlist.length", playlist.length);
			if (url == '' && currentItem < playlist.length) {
				url = playlist[currentItem];
			}
			if (url == '') {
				trace("Error " + currentItem + " " + currentUrl );
				lastError = "Cannot play the stream";
				updateState(4);
				return;
			}
		
			currentUrl = url;
			pickPlayerForUrl(url);
			player.start(url);
		}		
		private function pickPlayerForUrl(url:String):void {
			var type:String;
			if (/^rtmp:\/\//.test(currentUrl)) {
				type = "rtmp";
			} else {
				type = "mp3";
			}
			if (player.type != type) {
				player.stop();
			}
			player = (type == "mp3") ? mp3player : rtmpplayer;
			
		}
		public function tryNext():void {
			sendEvent("trace", "tryNext()");
			if (playlist.length > currentItem) {
				currentItem++; // try next playlist item
				stop();
				start();
			} else {
				if (player.wasPlaying) {
					lastError = "No more playlist entries";
					updateState(5);
				} else {
					stop();
					lastError = "Playback failed";
					updateState(4);
				}
			}
		}		
		public function stop():void {
			sendEvent("trace", "stop()");
			player.stop();
			currentUrl = "";
			lastError = "";
			updateState(1);	
		}
		public function restart():void {
			sendEvent("trace", "restart()");
			var oldUrl:String = currentUrl;
			stop();
			start(oldUrl);	
		}
		public function pause():void {
			sendEvent("trace", "pause()");
			player.pause();
			updateState(1);	
		}
		public function setPosition(pos:Number):void {
			sendEvent("trace", "setPosition(" + pos + ")");
			player.setPosition(pos);
		}		
		public function getLastError():String {
			return lastError;
		}		
		public function getDuration():Number {
			return player.getDuration();
		}
		public function setVolume(vol:Number):void {
			sendEvent("trace", "setVolume(" + vol + ")");
			player.setVolume(vol);
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
		public function sendEvent(name:String, param:Object):void	{
			trace(name + ": " + param); 
			if (ExternalInterface.available) {
				ExternalInterface.call("RadioTime.getUpdate", name, param, objectid);
			}
		}
		public function updateState(state:Number):void {
			if (currentState != state) {
				currentState = state;
				sendEvent("status", state);			
			}
		}	
		
	}
}