import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Btn, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { sb } from '@/lib/supabase';

// Email code sign in. Works the same on iPhone, Android and web; Apple and Google buttons come with the store builds.
export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState('');

  async function send() {
    setMsg('Sending…');
    const { error } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    if (error) { setMsg(error.message); return; }
    setSent(true); setMsg('Check your email for the code.');
  }
  async function verify() {
    const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    if (error) { setMsg(error.message); return; }
    router.back();
  }

  return (
    <Screen>
      <Title accent="in">Sign</Title>
      <Muted style={{ marginBottom: 14 }}>No password. Use the same email as dandystrength.com and your numbers come with you.</Muted>
      <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#5A6478" autoCapitalize="none" autoComplete="email"
        keyboardType="email-address" accessibilityLabel="Email" style={s.input} />
      <View style={{ height: 12 }} />
      {!sent ? <Btn label="Email me a code" onPress={send} /> : (
        <>
          <TextInput value={code} onChangeText={v => setCode(v.replace(/[^0-9]/g, ''))} placeholder="6 digit code" placeholderTextColor="#5A6478"
            keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" accessibilityLabel="Code"
            style={[s.input, { textAlign: 'center', letterSpacing: 8, fontSize: 24 }]} />
          <View style={{ height: 12 }} />
          <Btn label="Sign in" onPress={verify} />
          <View style={{ height: 8 }} />
          <Btn ghost label="Send a new code" onPress={send} />
        </>
      )}
      {msg ? <Muted style={{ marginTop: 12, textAlign: 'center', color: msg.includes('rror') ? C.down : C.muted }}>{msg}</Muted> : null}
    </Screen>
  );
}
