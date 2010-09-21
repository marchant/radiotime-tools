/**
* ...
* @author DefaultUser (Tools -> Custom Arguments...)
*/

class PlaylistParser 
{
	private var loader:LoadVars; 
	private var loaderInterval:Number;
	private var completed:Boolean = false;
	private var onSuccess:Function;
	private var onError:Function;
	private var currentUrl:String = "";
	
	public function PlaylistParser() 
	{
		
	}
	public function load(url:String, success:Function, error:Function) {
		
		currentUrl = url;
		onSuccess = success;
		onError = error;
		
		loader = new LoadVars();
		var ref = this;
		
		loader.onData = function(src:String){
			if (src != undefined) {
				if (ref.loader.getBytesTotal() > 100000) {
					ref._success([ref.currentUrl]);
				} else {
					ref.parse(src);
				}
			} else {
				ref._success([ref.currentUrl]);
				//ref._failure("No data returned");
			}
			ref.cancel();
		}
		loaderInterval = setInterval(this, "updatePlaylistLoaded", 100);

		if (!loader.load(url)) {
			ref._failure("Can't access playlist file");
		};

		/*
		if (!loader.sendAndLoad(url, loader, "GET")) {
			ref._failure("Can't access playlist file");
		};
		*/
	}
	private function parse(txt:String) {
		var lines:Array = [];
		var result:Array = [];

		if (txt.toLowerCase().indexOf("<html>") > -1) {
			trace(txt);
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
		if (txt.toLowerCase().indexOf("http://") < 0) {
			_failure("Not a playlist: no urls found");
			return;
		}
		if (txt.indexOf("[playlist]") > -1) {
			trace("pls");
		} else {
			trace("m3u?");
		}
		lines = txt.split("\n");
		for (var i = 0; i < lines.length; i++) {
			var ndx = lines[i].toLowerCase().indexOf("http://"); 
			if (ndx > -1) {
				result.push(lines[i].substring(ndx));
			}
		}	
		_success(result);
	}
	private function updatePlaylistLoaded() {
		trace("total " + loader.getBytesTotal());
		trace ("loaded " + loader.getBytesLoaded());
		var tot = loader.getBytesTotal();
		var loa = loader.getBytesLoaded();
		if (tot == undefined)
			return;
		if (loa > tot || tot > 100000) {
			cancel();
			_success([currentUrl]); // the url is the stream itself
		}
	}
	private function cancel() {
		clearInterval(loaderInterval);
		delete loader;
	}
	private function _success(result:Array) {
		trace(result);
		if (completed)
			return;
		completed = true;
		if (onSuccess != undefined)
			onSuccess.call(this, result);
	}
	private function _failure(error:String) {
		trace(error);
		if (completed)
			return;
		completed = true;	
		if (onError != undefined)
			onError.call(this, error);
		cancel();
	}
}