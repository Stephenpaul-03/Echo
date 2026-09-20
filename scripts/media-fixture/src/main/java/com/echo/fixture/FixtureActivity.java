package com.echo.fixture;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.MediaMetadata;
import android.media.MediaDescription;
import java.util.ArrayList;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.widget.TextView;

/** Emulator-only source: emits standard Android sessions without playing audio. */
public class FixtureActivity extends Activity {
  private MediaSession music;
  private MediaSession podcast;
  private int index = 1;
  private boolean playing = true;
  private long position = 12000;
  private boolean missingArt = false;
  private boolean unknownDuration = false;
  private boolean withQueue = false;
  private static final long ACTIONS = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
    PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    TextView label = new TextView(this);
    label.setText("Echo media-session test source\nNo audio is played.\nSwitch back to Echo to test controls.");
    label.setTextSize(24);
    label.setPadding(40, 60, 40, 40);
    setContentView(label);
    music = new MediaSession(this, "music");
    music.setCallback(new MediaSession.Callback() {
      @Override public void onPlay() { playing = true; update(); Log.i("EchoFixture", "PLAY"); }
      @Override public void onPause() { playing = false; update(); Log.i("EchoFixture", "PAUSE"); }
      @Override public void onSkipToNext() { index++; position = 0; update(); Log.i("EchoFixture", "NEXT"); }
      @Override public void onSkipToPrevious() { index--; position = 0; update(); Log.i("EchoFixture", "PREVIOUS"); }
      @Override public void onSeekTo(long value) { position = value; update(); Log.i("EchoFixture", "SEEK " + value); }
    });
    podcast = new MediaSession(this, "podcast");
    podcast.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Paused podcast")
      .putString(MediaMetadata.METADATA_KEY_ARTIST, "Competing session").build());
    podcast.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setState(PlaybackState.STATE_PAUSED, 0, 0).build());
    podcast.setActive(true);
    music.setActive(true);
    scenario(getIntent());
  }

  @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); scenario(intent); }
  private void scenario(Intent intent) {
    String mode = intent.getStringExtra("scenario");
    if ("competing".equals(mode)) {
      podcast.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "New playing podcast")
        .putString(MediaMetadata.METADATA_KEY_ARTIST, "Session switch verified").build());
      podcast.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setState(PlaybackState.STATE_PLAYING, 1000, 1).build());
    } else if ("empty".equals(mode)) {
      music.setActive(false); podcast.setActive(false);
    } else {
      withQueue = "queue".equals(mode);
      missingArt = "missing".equals(mode);
      unknownDuration = missingArt;
      podcast.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setState(PlaybackState.STATE_PAUSED, 0, 0).build());
      music.setActive(true);
      update();
    }
  }

  private void update() {
    MediaMetadata.Builder metadata = new MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, "fixture-" + index)
      .putString(MediaMetadata.METADATA_KEY_TITLE, "Test track " + index)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, "Echo integration fixture")
      .putString(MediaMetadata.METADATA_KEY_ALBUM, "Native session checks")
      .putLong(MediaMetadata.METADATA_KEY_DURATION, unknownDuration ? 0 : 180000);
    if (!missingArt) {
      Bitmap art = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
      Canvas canvas = new Canvas(art);
      canvas.drawColor(Color.rgb(32, 65, 60));
      Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
      paint.setColor(Color.rgb(200, 218, 161)); canvas.drawCircle(256, 230, 130, paint);
      paint.setColor(Color.rgb(48, 78, 65)); canvas.drawCircle(256, 230, 35, paint);
      metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
    }
    if (withQueue) {
      ArrayList<MediaSession.QueueItem> queue = new ArrayList<>();
      for (int i = 0; i < 4; i++) {
        Bitmap cover = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888);
        cover.eraseColor(Color.rgb(70 + i * 30, 100 + i * 20, 140 - i * 20));
        queue.add(new MediaSession.QueueItem(new MediaDescription.Builder().setMediaId("fixture-" + i)
          .setTitle("Queue track " + i).setSubtitle("Exposed queue").setIconBitmap(cover).build(), i));
      }
      music.setQueue(queue);
    } else music.setQueue(null);
    music.setMetadata(metadata.build());
    music.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS).setActiveQueueItemId(withQueue ? index : -1)
      .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1 : 0, SystemClock.elapsedRealtime()).build());
  }
  @Override public void onDestroy() { music.release(); podcast.release(); super.onDestroy(); }
}
