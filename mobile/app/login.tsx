import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Btn, Muted, s, Screen, Title } from '@/components/ui';
import { C } from '@/constants/Colors';
import { sb } from '@/lib/supabase';

// Email code sign in on iPhone, Android and web. A password option exists for the App Review account.
export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [sent, setSent] = useState(false);
  const [usePw, setUsePw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const addr = () => email.trim().toLowerCase();

  async function send() {
    if (!/^\S+@\S+\.\S+$/.test(addr())) { setMsg('Enter your email address.'); return; }
    setBusy(true); setMsg('Sending…');
    const { error } = await sb.auth.signInWithOtp({ email: addr(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) { setMsg(error.status === 429 ? 'Too many emails just now. Wait a minute and try again.' : error.message); return; }
    setSent(true); setMsg('Check your email for the 6 digit code.');
  }
  async function verify() {
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email: addr(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) { setMsg('That code did not work. Check it or send a new one.'); return; }
    router.back();
  }
  async function withPassword() {
    setBusy(true);
    const { error } = await sb.auth.signInWithPassword({ email: addr(), password: pw });
    setBusy(false);
    if (error) { setMsg('Email or password is wrong.'); return; }
    router.back();
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen stack>
        <Title accent="in">Sign</Title>
        <Muted style={{ marginBottom: 14, fontSize: 15 }}>No password needed. Use the same email as dandystrength.com and your numbers come with you.</Muted>
        <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#5A6478" autoCapitalize="none" autoComplete="email"
          keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="Email" style={s.input} editable={!sent} />
        <View style={{ height: 12 }} />
        {usePw ? (
          <>
            <TextInput value={pw} onChangeText={setPw} placeholder="Password" placeholderTextColor="#5A6478" secureTextEntry textContentType="password"
              accessibilityLabel="Password" style={s.input} />
            <View style={{ height: 12 }} />
            <Btn label="Sign in" onPress={withPassword} disabled={busy} />
          </>
        ) : !sent ? <Btn label="Email me a code" onPress={send} disabled={busy} /> : (
          <>
            <TextInput value={code} onChangeText={v => setCode(v.replace(/[^0-9]/g, ''))} placeholder="6 digit code" placeholderTextColor="#5A6478" maxLength={10}
              keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" accessibilityLabel="Code" autoFocus
              style={[s.input, { textAlign: 'center', letterSpacing: 8, fontSize: 24 }]} />
            <View style={{ height: 12 }} />
            <Btn label="Sign in" onPress={verify} disabled={busy || code.length < 6} />
            <View style={{ height: 8 }} />
            <Btn ghost label="Send a new code" onPress={send} disabled={busy} />
            <Pressable onPress={() => { setSent(false); setCode(''); setMsg(''); }} style={{ padding: 12, alignItems: 'center' }}>
              <Text style={{ color: C.muted }}>Use a different email</Text>
            </Pressable>
          </>
        )}
        {msg ? <Muted style={{ marginTop: 12, textAlign: 'center', fontSize: 14 }}>{msg}</Muted> : null}
        <Pressable onPress={() => { setUsePw(!usePw); setSent(false); setMsg(''); }} style={{ padding: 16, alignItems: 'center', marginTop: 16 }}>
          <Text style={{ color: C.muted, fontSize: 13 }}>{usePw ? 'Use an email code instead' : 'Sign in with a password'}</Text>
        </Pressable>
        <Muted style={{ textAlign: 'center', fontSize: 12 }}>By signing in you agree to the DSI terms and community rules.</Muted>
      </Screen>
    </KeyboardAvoidingView>
  );
}
