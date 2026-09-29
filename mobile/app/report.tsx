import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';

import { Btn, Chip, Eyebrow, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { block, report } from '@/lib/data';
import { useSession } from '@/lib/session';
import { sb } from '@/lib/supabase';

// One screen for reports (message, lifter, lift, log) and protests (lift, log).
export default function Report() {
  const { type, id, name, uid } = useLocalSearchParams<{ type: string; id: string; name?: string; uid?: string }>();
  const { me, reloadBlocks } = useSession();
  const isProtest = type?.startsWith('protest');
  const REASONS = isProtest
    ? ['Depth or form', 'No video or witness', 'Typo, wrong weight', 'Too good to be true']
    : ['Harassment or hate', 'Sexual or violent content', 'Spam or scam', 'Fake lifts', 'Something else'];
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(!isProtest && !!uid);
  const [busy, setBusy] = useState(false);

  if (!me) return <Screen stack><Muted>Sign in first.</Muted></Screen>;

  async function submit() {
    const text = [reason, detail.trim()].filter(Boolean).join(': ');
    if (text.length < 3) { Alert.alert('Pick a reason'); return; }
    setBusy(true);
    let error;
    if (isProtest) {
      ({ error } = await sb.from('protests').insert({ target_type: type === 'protest_log' ? 'workout_log' : 'lift_entry', target_id: id, filed_by: me!.id, reason: text.slice(0, 500) }));
    } else {
      ({ error } = await report(type as any, id, me!.id, text.slice(0, 500)));
      if (!error && alsoBlock && uid && uid !== me!.id) { await block(me!.id, uid); await reloadBlocks(); }
    }
    setBusy(false);
    if (error) { Alert.alert('That did not go through', error.message); return; }
    Alert.alert(isProtest ? 'Protest filed' : 'Thanks for reporting',
      isProtest ? 'The lift is flagged until the Commissioner rules.' : 'The DSI team reviews every report within 24 hours.' + (alsoBlock && uid ? ' You will no longer see this person.' : ''));
    router.back();
  }

  return (
    <Screen stack>
      <Title eyebrow={name ?? ''} accent={isProtest ? 'lift' : ''}>{isProtest ? 'Protest this' : 'Report'}</Title>
      <Eyebrow style={{ marginBottom: 8 }}>Reason</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{REASONS.map(r => <Chip key={r} label={r} on={reason === r} onPress={() => setReason(r)} />)}</View>
      <TextInput value={detail} onChangeText={setDetail} placeholder="Add detail (optional)" placeholderTextColor="#5A6478" multiline maxLength={400}
        style={[s.input, { height: 110, paddingTop: 12, textAlignVertical: 'top', fontSize: 16, marginVertical: 12 }]} accessibilityLabel="Details" />
      {!isProtest && uid && uid !== me.id ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Text style={{ color: C.ink, flex: 1, fontSize: 15 }}>Also block this person</Text>
          <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: C.accent, false: C.line }} thumbColor={C.ink} />
        </View>
      ) : null}
      <Btn label={isProtest ? 'File protest' : 'Send report'} onPress={submit} disabled={busy || !reason} />
      <Muted style={{ marginTop: 12, textAlign: 'center', fontSize: 13 }}>{isProtest ? 'JB31, the Commissioner, rules on every protest.' : 'Reports are private. The person is not told who reported them.'}</Muted>
    </Screen>
  );
}
