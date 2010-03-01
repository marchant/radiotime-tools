package radiotime
{
	/**
	* ...
	* @author alex
	*/

	import flash.media.Sound;
	import flash.media.SoundChannel;
	import flash.media.SoundTransform;
	import flash.media.SoundLoaderContext;
	import flash.net.URLLoader;
	import flash.net.URLRequest;
	import flash.events.*;
	import flash.utils.Timer;
	
	public class MP3Player
	{
		private var soundObject:Sound;
		
		private var channel:SoundChannel;
        private var positionTimer:Timer;
		
		private var restartInterval:Number = 30; //minutes 
		
		private var currentLoaded:Number = 0;
		private var currentPosition:Number = 0;
		private var itemDuration:Number = 0;
		
		private var loadedInterval:Number;
		private var currentVolume:Number = 60;
		private var currentUrl:String = "";
		private var loadingCount:Number = 0;
		private var isFile:Boolean = false;
		
		public var wasPlaying:Boolean = false;
		public var isPaused:Boolean = false;
		public var controller:PlayerController = null;
		public var type:String = "mp3";
		
		public function MP3Player(c:PlayerController) 
		{
			controller = c;
		}

		public function start(url:String):void { 		
			controller.sendEvent("trace", "mp3 start url: " + url);
			if (!currentUrl) {
				wasPlaying = false;
				currentUrl = url;
				soundObject = null;
				soundObject = new Sound();
				var request:URLRequest = new URLRequest(url);
				
				var context:SoundLoaderContext = new SoundLoaderContext(5000 /*buffer in ms*/, true/*check security policy*/);

				soundObject.addEventListener(Event.COMPLETE, completeHandler);
				soundObject.addEventListener(Event.ID3, id3Handler);
				soundObject.addEventListener(IOErrorEvent.IO_ERROR, ioErrorHandler);
				soundObject.addEventListener(ProgressEvent.PROGRESS, progressHandler);
				try {
					soundObject.load(request, context);
				} catch (err:Error) {
					trace("Error closing stream: " + err.message);
				}
			
				isFile = false;

				currentPosition = 0;
				controller.sendEvent("progress", 0);
			}
			isPaused = false;
			if (controller.currentState == 3)
				return;
				
			controller.sendEvent("trace", "currentPosition: " + currentPosition); 
			channel = soundObject.play(currentPosition);
			setVolume(currentVolume);
			channel.addEventListener(Event.SOUND_COMPLETE, soundCompleteHandler);

			positionTimer = new Timer(100);
			positionTimer.addEventListener(TimerEvent.TIMER, positionTimerHandler);
			positionTimer.start();
		}
        private function positionTimerHandler(event:TimerEvent):void {
			var pos:Number = channel.position;
			if (pos > restartInterval * 60 * 1000 && !isFile) {
				controller.sendEvent("trace", "restarting stream on timeout to reset RAM usage");
				controller.restart();
				return;
			}
			trace("pos " + channel.position + " of " + soundObject.length);

			if (pos == currentPosition) {
				loadingCount++;
				if (loadingCount > 2)
					controller.updateState(2);
			} else { 
				if (!isNaN(soundObject.length) && soundObject.length > 0) {
					controller.sendEvent("position", 100 * pos / soundObject.length);
					
				}
				wasPlaying = true;
				loadingCount = 0;
				controller.updateState(3);
				currentPosition = pos;
			}
        }

        private function completeHandler(event:Event):void {
			if (soundObject.length == 0) {
				
				if (currentUrl.indexOf(";stream.nsv") < 0 && currentUrl.indexOf("/listen.stream?streamId=") < 0) { // try to handle shoutcast, exclude RadioTime stream proxy URL
					var newUrl:String = currentUrl;
					if (currentUrl.indexOf(".m3u") < 0) {
						
						newUrl = newUrl.split("listen.pls").join("");
						newUrl = newUrl.split(".pls").join("");
						if (newUrl.match(/^\s*(\S*)\s*$/)) {
							newUrl = newUrl.match(/^\s*(.*?)\s*$/)[1];
						}
						if (newUrl.substr( -1) != "/")
							newUrl += "/";
						newUrl += ";stream.nsv";						
					} else {
						newUrl = newUrl.slice(0, currentUrl.indexOf(".m3u"));
					}
					
					stop();
					start(newUrl);	
					
				} else {
					controller.tryNext();
				}
			}
        }

        private function id3Handler(event:Event):void {
			isFile = true;
			
			if (!soundObject) return;
			for (var property:String in soundObject.id3) {
				trace(property + ":" + soundObject.id3[property]);
			}
			if (soundObject.id3["songname"] != undefined) {
				controller.sendEvent("nowplaying", soundObject.id3["songname"]);
			} else if (soundObject.id3["TIT2"]) {
				controller.sendEvent("nowplaying", soundObject.id3["TIT2"]);
			}
        }

        private function ioErrorHandler(event:IOErrorEvent):void {
            trace("ioErrorHandler: " + event);
			controller.lastError = event.text;
            controller.tryNext();      
        }

        private function progressHandler(event:ProgressEvent):void {
			if (!soundObject) return;
			var pct:Number = 0;
			if (soundObject.bytesTotal > 0) {
				pct = Math.round(soundObject.bytesLoaded / soundObject.bytesTotal * 100);
				if(isNaN(pct)) { 
					pct = 0; 
				} 
			}
			if (pct != currentLoaded) {
				controller.sendEvent("progress", pct); 
				currentLoaded = pct;
			} 
        }

        private function soundCompleteHandler(event:Event):void {
            trace("soundCompleteHandler: " + event);
            positionTimer.stop();
			controller.tryNext();
        }
		public function stop():void {
			if (channel) {
				channel.stop();
			}
			if (positionTimer) {
				positionTimer.stop();
			}
			
			currentUrl = "";
			if (soundObject) {
				try {
					soundObject.close();
				} catch (err:Error) {
					trace("Error closing stream: " + err.message);
				}
			}
			//soundObject = null;
			currentLoaded = 0;
			currentPosition = 0;
			isPaused = false;
		}
		public function pause():void {
			if (channel) {
				channel.stop();
			}
			if (positionTimer) {
				positionTimer.stop();
			}
			isPaused = true;
		}
		public function setPosition(pos:Number):void {
			currentPosition = pos;
			if (soundObject != null) {
				pause();
				start(currentUrl);
			}
		}
		public function getDuration():Number {
			if (soundObject != null) {
				return soundObject.length;
			} else {
				return 0;
			}
		}
		public function setVolume(vol:Number):void {
			currentVolume = vol;
			if (soundObject != null) {
				var st:SoundTransform = new SoundTransform(vol / 100);
				channel.soundTransform = st;
			}
		}

	}
}