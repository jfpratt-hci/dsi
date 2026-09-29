import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import { sb } from './supabase';

// Pick or record a video, upload to lift-videos/<profile>/<entry>.<ext>, attach it to the lift entry.
export async function addVideo(entryId: string, profileId: string, source: 'camera' | 'library'): Promise<string | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) { Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access in Settings to record your lift.' : 'Allow photo access in Settings to pick a video.'); return null; }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], videoMaxDuration: 60, quality: 0.7 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  if (a.fileSize && a.fileSize > 100 * 1024 * 1024) { Alert.alert('Too big', 'Keep videos under 100 MB, about a minute.'); return null; }
  const ext = (a.uri.split('.').pop() || 'mp4').toLowerCase();
  const type = a.mimeType || (ext === 'mov' ? 'video/quicktime' : 'video/mp4');
  const path = `${profileId}/${entryId}.${ext}`;
  const body = await (await fetch(a.uri)).arrayBuffer();
  const up = await sb.storage.from('lift-videos').upload(path, body, { contentType: type, upsert: true });
  if (up.error) { Alert.alert('Upload failed', up.error.message); return null; }
  const { error } = await sb.from('lift_entries').update({ video_path: path }).eq('id', entryId);
  if (error) { Alert.alert('Could not attach video', error.message); return null; }
  return path;
}
