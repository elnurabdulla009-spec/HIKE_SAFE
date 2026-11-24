// App entry point.
// The background GPS task must be defined before anything renders: the OS can launch the
// app headless just to deliver locations, and an undefined task would drop those fixes.
import './src/lib/locationTask';
import 'expo-router/entry';
