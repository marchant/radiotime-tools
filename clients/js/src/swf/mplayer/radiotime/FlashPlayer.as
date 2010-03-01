package radiotime 
{
    import flash.events.NetStatusEvent;
    import flash.events.SecurityErrorEvent;
	import flash.media.SoundTransform;
    import flash.media.Video;
    import flash.net.NetConnection;
    import flash.net.NetStream;
    import flash.events.*;
	import flash.utils.Timer;
	
	/**
	* ...
	* @author alex
	*/
	public class FlashPlayer 
	{
		private var currentUrl:String = "";
		private var currentStreamer:String = "";	
        private var connection:NetConnection;
        private var stream:NetStream;
		protected var video:Video;
		private var currentVolume:Number = 60;
		
		private var progressTimer:Timer = null;
		private var currentLoaded:Number = 0;
		
		public var wasPlaying:Boolean = false;
		public var isPaused:Boolean = false;
		public var controller:PlayerController = null;		
		public var type:String = "rtmp";
		
		public function FlashPlayer(c:PlayerController) 
		{
			controller = c;
            connection = new NetConnection();
			connection.client = this;
            connection.addEventListener(NetStatusEvent.NET_STATUS, netStatusHandler);
            connection.addEventListener(SecurityErrorEvent.SECURITY_ERROR, errorHandler);
			connection.addEventListener(IOErrorEvent.IO_ERROR, errorHandler);
			connection.addEventListener(AsyncErrorEvent.ASYNC_ERROR, errorHandler);
		}
		
		public function start(url:String = '', resource:String = ''):void {
			if (isPaused && stream) {
				stream.resume();
				return;
			}
			
			if (resource == '') {
				var matches:Array = url.match(/^(.+\/)([^\/]+)$/);
				currentStreamer = matches[1];
				currentUrl = matches[2];
			} else {
				currentStreamer = url;
				currentUrl = resource;
			}
			
			if (currentStreamer && currentUrl) { 
				connection.connect(currentStreamer);
			}
			setVolume(currentVolume);
			wasPlaying = false;
			controller.sendEvent("progress", 0);
			
			progressTimer = new Timer(100);
			progressTimer.addEventListener(TimerEvent.TIMER, progressTimerHandler);
			progressTimer.start();
		}
		
		public function stop():void {
			if (stream) {
				stream.close();
				stream = null;
			}
			if (connection.connected) {
				connection.close();
			}
			if (progressTimer) {
				progressTimer.stop();
			}
			isPaused = false;
		}
		
		public function pause():void {
			if (stream) {
				stream.pause();
				isPaused = true;
			}
			if (progressTimer) {
				progressTimer.stop();
			}
		}
		public function setPosition(pos:Number):void {
			if (stream) {
				stream.seek(pos);
			}
		}
		public function getDuration():Number {
			return 0;
		}
		public function setVolume(vol:Number):void {
			currentVolume = vol;
			if (stream) {
				var st:SoundTransform = new SoundTransform(vol / 100);
				stream.soundTransform = st;
			}
		}
        private function connectStream():void {
            stream = new NetStream(connection);
			stream.client = this;
            stream.addEventListener(NetStatusEvent.NET_STATUS, netStatusHandler);
			stream.addEventListener(IOErrorEvent.IO_ERROR, errorHandler);
			stream.addEventListener(AsyncErrorEvent.ASYNC_ERROR, errorHandler);
			stream.checkPolicyFile = true;
			stream.bufferTime = 5;
			
            video = new Video(); 
            video.attachNetStream(stream);
            stream.play(formatURL(currentUrl));
        }
		
		protected function formatURL(url:String):String {
			var ext:String = url.substr(-4);
			if (ext == '.mp3') {
				return 'mp3:' + url.substr(0, url.length - 4);
			} else if (ext == '.mp4' || ext == '.mov' || ext == '.aac' || ext == '.m4a' || ext == '.f4v') {
				return 'mp4:' + url;
			} else if (ext == '.flv') {
				return url.substr(0, url.length - 4);
			} else {
				return url;
			}
		}
		
        private function netStatusHandler(event:NetStatusEvent):void {
            switch (event.info.code) {
                case "NetConnection.Connect.Success":
					//connection.call("checkBandwidth", null); 
                    connectStream();
                    break;
				case "NetStream.Buffer.Empty":
					trace("Buffer empty");
					controller.updateState(2);
					break;
				case "NetStream.Buffer.Full":
					trace("Buffer full, start playing");
					controller.updateState(3);
					wasPlaying = true;
					break;		
					
				default:
					trace("NetStatus: " + event.info.code);
					
					// Other error
					if (event.info.level == "error") {
						progressTimer.stop();
						controller.lastError = event.info.code;
						controller.tryNext();
					}
					break;
            }
        }

        private function errorHandler(event:ErrorEvent):void {
            trace("error occured: " + event.text);
			progressTimer.stop();
			controller.lastError = event.text;
            controller.tryNext(); 
        }
		
		private function progressTimerHandler(event:TimerEvent):void {
			var pct:Number = 0;
			if (stream) {
				pct = Math.round(stream.bytesLoaded / stream.bytesTotal * 100);
				if(isNaN(pct)) { 
					pct = 0; 
				} 
			}

			if (pct != currentLoaded) {
				controller.sendEvent("progress", pct); 
				currentLoaded = pct;
			} 
		}
		public function onPlayStatus(event:Object):void {
			trace("onPlayStatus: " + event.info.code);
			if (event.info.code == "NetStream.Play.Complete")
			{
				controller.tryNext(); 
			}
		}
		
		public function onBWCheck(... rest):Number { 
			return 0; 
		} 
		public function onBWDone(... rest):void { 
			var p_bw:Object; 
			if (rest.length > 0) p_bw = rest[0]; 
			trace("bandwidth = " + p_bw + " Kbps."); 
		} 
		public function close():void {

		}
		public function onMetaData(info:Object):void {
			for (var i:String in info)
			{
				trace(i + "=" + info[i]);
			}
			if (info["title"] && info["artist"]) {
				controller.sendEvent("nowplaying", info["artist"] + " - " + info["title"]);
			}
		}
		public function onCuePoint(info:Object):void {
			trace("cuepoint: time=" + info.time + " name=" + info.name + " type=" + info.type);
		}
		public function onFCSubscribe (info:Object):void {
			
		}
		public function onFCUnsubscribe (info:Object):void {
			
		}		
	}
	
}