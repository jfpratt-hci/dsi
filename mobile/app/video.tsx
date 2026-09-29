import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { videoUrl } from '@/lib/data';

export default function Video() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const player = useVideoPlayer(videoUrl(path), p => { p.loop = true; p.play(); });
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flex: 1 }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
      </View>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close video" style={{ position: 'absolute', top: 56, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 22 }}>✕</Text>
      </Pressable>
    </SafeAreaView>
  );
}
