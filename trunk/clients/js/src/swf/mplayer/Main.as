package  
{
	import flash.display.Sprite;
	import flash.display.LoaderInfo;
	import flash.system.Capabilities;
	import flash.system.Security;
	import radiotime.PlayerController;
	/**
	* ...
	* @author alex
	*/
	public class Main extends Sprite
	{
		public function Main():void 
		{
			Security.allowDomain("*");
			//var url:String = "http://edge-dl.andomedia.com/800185/download.andomedia.com/atom2/creative/9483_32.mp3";//"http://steady.somafm.com:8032/listen.pls";
			//var url:String = "http://str16.streamakaci.com:9100";
			//var url:String = "http://download.publicradio.org/podcast/marketplace/pm/2009/12/16/marketplace_cast2_20091216_64.mp3?_kip_ipx=277320265-1261060626";
			//var url:String = "http://216.66.69.100:6210/listen.pls";
			//var url:String = "http://voicq.com/webtuner/mission.mp3";
			//var url:String = "http://voicq.com/webtuner/playlist.pls";
			//var url:String = "http://stream.radiotime.com/listen.stream?streamId=1524801"; //aac test
			//var url:String = "http://dev.radiotime.com/stream/listen.stream?streamId=1448346"; //rtmp
			//var url:String = "http://stream.radiotime.com/listen.stream?streamId=546845";
			//var url:String = "http://207.200.96.230:8030/;stream.nsv";
			//var url:String = "rtmp://cp72151.live.edgefcs.net/live/WMOJ-FM@10681";
			
			trace('Audio playback support: ' + Capabilities.hasAudio);
			trace('MP3 support: ' + Capabilities.hasMP3);
			trace('Audio streaming support: ' + Capabilities.hasStreamingAudio);
			
			var pc:PlayerController = new PlayerController(getSwfParam("objectid", ""));
			//pc.safeStart(url);
			//pc.start(url);
			
			var file:String = getSwfParam("file", "");
			if (file != "")
				pc.start(file);
		}
		protected function getSwfParam(name:String, defaultValue:String):String
		{
			var paramObj:Object = LoaderInfo(stage.loaderInfo).parameters;
					   
			if(paramObj[name] != null && paramObj[name] != "")
				return paramObj[name];
					   
			else
				return defaultValue;
		}
		
	}
	
}