import { router } from 'expo-router';
import { useState } from 'react';
import { api, ApiError } from '../src/data/index.ts';
import { Body, Button, ErrorText, Field, Screen, Title } from '../src/components/ui.tsx';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Explore more.{'\n'}Return safely.</Title>
      <Body muted>Sign in with your email. We send a 6-digit code — no password to remember or leak.</Body>

      {step === 'email' ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com"
            autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <ErrorText message={error} />
          <Button title="Send code" busy={busy}
            onPress={() => run(async () => { await api.requestSignInCode(email.trim()); setStep('code'); })} />
        </>
      ) : (
        <>
          <Body>Code sent to {email.trim()}.</Body>
          <Field label="6-digit code" value={code} onChangeText={setCode} placeholder="123456"
            keyboardType="number-pad" maxLength={6} />
          <ErrorText message={error} />
          <Button title="Sign in" busy={busy}
            onPress={() => run(async () => { await api.verifySignInCode(email.trim(), code.trim()); router.replace('/'); })} />
          <Button title="Use another email" variant="secondary" onPress={() => { setStep('email'); setCode(''); setError(null); }} />
        </>
      )}
    </Screen>
  );
}
