package radiotime
{
	/**
	* ...
	* @author DefaultUser (Tools -> Custom Arguments...)
	*/
	import flash.net.URLLoader;
	import flash.net.URLRequest;
	import flash.events.*;
	
	internal class PlaylistParser 
	{
		private var loader:URLLoader = null; 
		private var completed:Boolean = false;
		private var onSuccess:Function = null;
		private var onError:Function = null;
		private var currentUrl:String = "";
		
		public function PlaylistParser() 
		{
			
		}
		public function load(url:String, success:Function, error:Function):void {
			
			currentUrl = url;
			onSuccess = success;
			onError = error;
			
			// Don't mess with non-http URLs
			if (!(/^http:\/\//.test(url))) {
				_success([url]);
				return;
			}
			
			var request:URLRequest = new URLRequest(url);
			if (loader == null) {
				loader = new URLLoader();
			}
			var ref:PlaylistParser = this;

			loader.addEventListener(Event.COMPLETE, completeHandler);
			loader.addEventListener(IOErrorEvent.IO_ERROR, errorHandler);
			loader.addEventListener(ProgressEvent.PROGRESS, progressHandler);
			
			try {
                loader.load(request);
            }
            catch (error:SecurityError)
            {
                ref._failure("Can't access playlist file");
            }

		}
		private function completeHandler(e:Event):void {
			trace("PL loaded");
			trace(loader.data);
			if (loader.data != undefined) {
				if (loader.bytesTotal > 100000) {
					_success([currentUrl]);
				} else {
					parse(loader.data);
				}
			} else {
				_success([currentUrl]);
			}
			cancel();
		}
		private function errorHandler(e:IOErrorEvent):void {
			_failure("IO Error");
		}
		private function progressHandler(e:ProgressEvent):void {
			trace("PL progress: " + e.bytesLoaded + " of " + e.bytesTotal);
			var tot:Number = e.bytesTotal;
			var loa:Number = e.bytesLoaded; 
			if (isNaN(tot))
				return;
			if (loa > 100000 || tot > 100000) {
				cancel();
				_success([currentUrl]); // the url is the stream itself
			}
		}
		private function parse(txt:String):void {
			var lines:Array = [];
			var result:Array = [];

			if (txt.toLowerCase().indexOf("<html>") > -1) {
				if (txt.toLowerCase().indexOf("shoutcast") > -1 && currentUrl.indexOf(";stream.nsv") < 0) { // try to handle shoutcast
					var newUrl:String = currentUrl;
					if (newUrl.substr( -1) != "/")
						newUrl += "/";
					newUrl += ";stream.nsv";
					_success([newUrl]);
					return;
				} 
				_failure("Not a playlist: html page");
				return;
			}
			if (!(/(http|https|rtmp):\/\//i.test(txt))) {
				_failure("Not a playlist: no urls found");
				return;
			}
			if (txt.indexOf("[playlist]") > -1) {
				trace("pls");
			} else {
				trace("m3u?");
			}
			/*
			lines = txt.split("\n");
			for (var i:Number = 0; i < lines.length; i++) {
				var ndx:Number = lines[i].toLowerCase().indexOf("http://"); 
				if (ndx > -1) {
					result.push(lines[i].substring(ndx));
				}
			}	
			*/
			var re:RegExp = /(http|https|rtmp):\/\/.+\b/ig; //  was  /(http|https|rtmp|mms|rtsp):\/\/.+\b/ig;
			var matches:Array = re.exec(txt);
			while (matches) {
				var u:String = matches[0];
				result.push(u);
				matches = re.exec(txt);
			}
			_success(result);
		}

		private function cancel():void {
			try {
				loader.close();
			} catch (error:Error) {
				trace('No request to close');
			}
		}
		private function _success(result:Array):void {
			trace(result);
			if (completed)
				return;
			completed = true; 
			if (onSuccess != null)
				onSuccess.call(this, result);
		}
		private function _failure(error:String):void {
			trace(error);
			if (completed)
				return;
			completed = true;	
			if (onError != null)
				onError.call(this, error);
			cancel();
		}
	}
}