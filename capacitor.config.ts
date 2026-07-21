import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "au.com.powertechconsulting.meetingminder",
  appName: "MeetingMinder",
  webDir: "dist",
  android: {
    // The WebView needs a secure origin for getUserMedia/MediaRecorder to work.
    // Capacitor serves from https://localhost by default on Android, which qualifies.
    allowMixedContent: false,
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
