package com.pvella.meetingminder;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Requests RECORD_AUDIO up front. The WebView's getUserMedia call cannot
 * succeed until the host app holds the Android runtime permission, and asking
 * at launch avoids the first tap on "Start recording" failing silently.
 */
public class MainActivity extends BridgeActivity {

    private static final int RECORD_AUDIO_REQUEST = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    RECORD_AUDIO_REQUEST);
        }
    }
}
