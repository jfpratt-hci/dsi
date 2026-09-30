import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Muted } from '@/components/ui';
import { C } from '@/constants/Colors';
import { block, timeAgo } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

type Msg = { id: string; room_id: string; profile_id: string; body: string; deleted: boolean; created_at: string };

export default function Room() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { me, isStaff, isPro, blocked, reloadBlocks } = useSession();
  const [kind, setKind] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const list = useRef<FlatList<Msg>>(null);

  async function loadNames(ids: string[]) {
    const need = ids.filter(x => !names[x]);
    if (!need.length) return;
    const { data } = await sb.from('profiles').select('id,display_name').in('id', need);
    setNames(n => ({ ...n, ...Object.fromEntries((data ?? []).map((p: any) => [p.id, p.display_name || 'Someone'])) }));
  }

  useEffect(() => { sb.from('chat_rooms').select('kind').eq('id', id).maybeSingle().then(({ data }) => setKind(data?.kind ?? 'group')); }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await sb.from('messages').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(200);
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      const m = ((data ?? []) as Msg[]).reverse();
      setMsgs(m); loadNames([...new Set(m.map(x => x.profile_id))]);
    })();
    const ch = sb.channel('room-' + id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + id }, p => {
        const m = p.new as Msg; loadNames([m.profile_id]);
        setMsgs(prev => (prev && !prev.some(x => x.id === m.id) ? [...prev, m] : prev));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'room_id=eq.' + id }, p => {
        const m = p.new as Msg; setMsgs(prev => prev?.map(x => (x.id === m.id ? m : x)) ?? prev);
      })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [id]);

  const shown = (msgs ?? []).filter(m => !blocked.has(m.profile_id));
  useEffect(() => { setTimeout(() => list.current?.scrollToEnd({ animated: false }), 50); }, [shown.length]);

  async function send() {
    const body = text.trim(); if (!body || !me) return;
    if (!me.terms_accepted_at) { router.push('/terms'); return; }
    setText('');
    const { data, error } = await sb.from('messages').insert({ room_id: id, profile_id: me.id, body }).select().single();
    if (error) { setText(body); Alert.alert('Not sent', error.message); return; }
    setMsgs(prev => (prev && !prev.some(x => x.id === data.id) ? [...prev, data as Msg] : prev));
  }

  function actions(m: Msg) {
    if (!me || m.deleted) return;
    const mine = m.profile_id === me.id, who = names[m.profile_id] || 'this person';
    const remove = async () => { const { error } = await sb.from('messages').update({ deleted: true }).eq('id', m.id); if (error) Alert.alert('Could not remove', error.message); };
    const opts: { label: string; run: () => void; destructive?: boolean }[] = [];
    if (mine || isStaff) opts.push({ label: 'Remove message', run: remove, destructive: true });
    if (!mine) {
      opts.push({ label: 'Report message', run: () => router.push({ pathname: '/report', params: { type: 'message', id: m.id, name: `Message from ${who}`, uid: m.profile_id } }) });
      opts.push({ label: `Block ${who}`, destructive: true, run: async () => { const { error } = await block(me.id, m.profile_id); if (!error) { await reloadBlocks(); Alert.alert('Blocked', `You will not see messages from ${who}.`); } } });
    }
    if (!opts.length) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...opts.map(o => o.label), 'Cancel'], cancelButtonIndex: opts.length, destructiveButtonIndex: opts.map((o, i) => (o.destructive ? i : -1)).filter(i => i >= 0) },
        i => { if (i < opts.length) opts[i].run(); });
    } else {
      Alert.alert('Message', m.body.slice(0, 80), [...opts.map(o => ({ text: o.label, onPress: o.run, style: o.destructive ? 'destructive' as const : 'default' as const })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: title || 'Chat' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
        {err ? <Muted style={{ padding: 16 }}>{err}</Muted> : null}
        <FlatList ref={list} data={shown} keyExtractor={m => m.id} contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={msgs ? <Muted style={{ textAlign: 'center', marginTop: 40, fontSize: 15 }}>No messages yet. Start it.</Muted> : null}
          renderItem={({ item: m }) => {
            const mine = m.profile_id === me?.id;
            return (
              <Pressable onLongPress={() => actions(m)} delayLongPress={300} accessibilityHint="Long press for report and block"
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <Text style={{ color: C.muted, fontSize: 12, marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                  <Text style={{ color: C.ink, fontWeight: '700' }} onPress={() => router.push({ pathname: '/lifter/[id]', params: { id: m.profile_id } })}>{names[m.profile_id] ?? '…'}</Text> · {timeAgo(m.created_at)}
                </Text>
                <View style={{ backgroundColor: mine ? 'rgba(242,201,76,0.14)' : C.panel2, borderColor: mine ? 'rgba(242,201,76,0.35)' : C.line, borderWidth: 1, borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Text style={{ color: m.deleted ? C.muted : C.ink, fontStyle: m.deleted ? 'italic' : 'normal', fontSize: 16 }}>{m.deleted ? 'Message removed' : m.body}</Text>
                </View>
              </Pressable>
            );
          }} />
        {kind && kind !== 'group' && !isPro ? (
          <Pressable onPress={() => router.push('/pro')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#0B1019' }}>
            <Text style={{ color: C.ink, fontWeight: '600' }}>Posting in threads is part of DSI Pro</Text><Text style={{ color: C.accent, fontWeight: '800' }}>›</Text>
          </Pressable>
        ) : (
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#0B1019' }}>
          <TextInput value={text} onChangeText={setText} placeholder={me?.roast_opt_in ? 'Say something. Roasts welcome.' : 'Say something'} placeholderTextColor="#5A6478"
            multiline maxLength={1000} accessibilityLabel="Message"
            style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, color: C.ink, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 }} />
          <Pressable onPress={send} disabled={!text.trim()} accessibilityRole="button" accessibilityLabel="Send"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? C.accent : C.line, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }}>
            <Text style={{ color: '#141414', fontSize: 20, fontWeight: '900' }}>↑</Text>
          </Pressable>
        </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
