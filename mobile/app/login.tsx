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
  const [useText, setUseText] = useState(false);
  const [phone, setPhone] = useState('');
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
  // Text codes go to a mobile number already added to an account (Account, Sign in options on the website).
  const e164 = (v: string) => { const n = v.replace(/\D/g, ''); return n.length === 10 ? '+1' + n : n.length === 11 && n[0] === '1' ? '+' + n : ''; };
  async function sendText() {
    const ph = e164(phone);
    if (!ph) { setMsg('Type a 10 digit mobile number.'); return; }
    setBusy(true); setMsg('Texting…');
    const { error } = await sb.auth.signInWithOtp({ phone: ph, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) { setMsg(/provider|disabled|enabled/i.test(error.message) ? 'Text codes are not switched on yet. Use an email code for now.' : /signups|not found|otp/i.test(error.message) ? 'No account has this number yet. Sign in with email, then add your number on dandystrength.com under Sign in options.' : error.message); return; }
    setSent(true); setMsg('Check your texts for the 6 digit code.');
  }
  async function verifyText() {
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ phone: e164(phone), token: code.trim(), type: 'sms' });
    setBusy(false);
    if (error) { setMsg('That code did not work. Check it or send a new one.'); return; }
    router.back();
  }
  async function forgot() {
    if (!/^\S+@\S+\.\S+$/.test(addr())) { setMsg('Type your email first.'); return; }
    setBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(addr(), { redirectTo: 'https://dandystrength.com/security?reset=1' });
    setBusy(false);
    setMsg(error ? error.message : 'Check your email for a link to set your password.');
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
        {useText ? <TextInput value={phone} onChangeText={setPhone} placeholder="513 555 0100" placeholderTextColor="#5A6478" keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" accessibilityLabel="Mobile number" style={s.input} editable={!sent} /> : null}
        {useText ? null : <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#5A6478" autoCapitalize="none" autoComplete="email"
          keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="Email" style={s.input} editable={!sent} />}
        <View style={{ height: 12 }} />
        {usePw ? (
          <>
            <TextInput value={pw} onChangeText={setPw} placeholder="Password" placeholderTextColor="#5A6478" secureTextEntry textContentType="password"
              accessibilityLabel="Password" style={s.input} />
            <View style={{ height: 12 }} />
            <Btn label="Sign in" onPress={withPassword} disabled={busy} />
            <Pressable onPress={forgot} style={{ padding: 12, alignItems: 'center' }}><Text style={{ color: C.muted }}>Forgot or never set a password?</Text></Pressable>
          </>
        ) : !sent ? <Btn label={useText ? 'Text me a code' : 'Email me a code'} onPress={useText ? sendText : send} disabled={busy} /> : (
          <>
            <TextInput value={code} onChangeText={v => setCode(v.replace(/[^0-9]/g, ''))} placeholder="6 digit code" placeholderTextColor="#5A6478" maxLength={10}
              keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" accessibilityLabel="Code" autoFocus
              style={[s.input, { textAlign: 'center', letterSpacing: 8, fontSize: 24 }]} />
            <View style={{ height: 12 }} />
            <Btn label="Sign in" onPress={useText ? verifyText : verify} disabled={busy || code.length < 6} />
            <View style={{ height: 8 }} />
            <Btn ghost label="Send a new code" onPress={useText ? sendText : send} disabled={busy} />
            <Pressable onPress={() => { setSent(false); setCode(''); setMsg(''); }} style={{ padding: 12, alignItems: 'center' }}>
              <Text style={{ color: C.muted }}>{useText ? 'Use a different number' : 'Use a different email'}</Text>
            </Pressable>
          </>
        )}
        {msg ? <Muted style={{ marginTop: 12, textAlign: 'center', fontSize: 14 }}>{msg}</Muted> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
          {[['code', 'Email code'], ['pw', 'Password'], ['text', 'Text me a code']].filter(([k]) => k !== (usePw ? 'pw' : useText ? 'text' : 'code')).map(([k, l]) => (
            <Pressable key={k} onPress={() => { setUsePw(k === 'pw'); setUseText(k === 'text'); setSent(false); setCode(''); setMsg(''); }} style={{ padding: 12 }}>
              <Text style={{ color: C.muted, fontSize: 13 }}>Use {l.toLowerCase()}</Text>
            </Pressable>))}
        </View>
        <Muted style={{ textAlign: 'center', fontSize: 12 }}>By signing in you agree to the DSI terms and community rules.</Muted>
      </Screen>
    </KeyboardAvoidingView>
  );
}
