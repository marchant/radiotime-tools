
class Main
{
	public static function main():Void
	{
		//var url:String = "http://edge-dl.andomedia.com/800185/download.andomedia.com/atom2/creative/9483_32.mp3";//"http://steady.somafm.com:8032/listen.pls";
		//var url:String = "http://str16.streamakaci.com:9100";
		//var url:String = "http://download.publicradio.org/podcast/marketplace/pm/2009/12/16/marketplace_cast2_20091216_64.mp3?_kip_ipx=277320265-1261060626";
		//var url:String = "http://216.66.69.100:6210/listen.pls";
		//var url:String = "http://voicq.com/webtuner/mission.mp3";
		//var url:String = "http://voicq.com/webtuner/playlist.pls";
		//var url:String = "http://stream.radiotime.com/listen.stream?streamId=526903";
		//var url:String = "http://kexp-mp3-2.cac.washington.edu:8000/;stream.nsv";
		
		trace('Audio playback support: ' + System.capabilities.hasAudio);
		trace('MP3 support: ' + System.capabilities.hasMP3);
		trace('Audio streaming support: ' + System.capabilities.hasStreamingAudio);
		
		var mp:MP3Player = new MP3Player();
		//mp.safeStart(url);
		//mp.start(url);
		if (_root.file != undefined)
			mp.start(_root.file);
	}

	
}