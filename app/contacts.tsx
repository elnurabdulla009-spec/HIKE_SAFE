import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError, type TrustedContact } from '../src/data/index.ts';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '../src/components/ui.tsx';
import { useSignedIn } from '../src/components/useSignedIn.ts';

export default function Contacts() {
  const signedIn = useSignedIn();
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.listContacts().then(setContacts, () => {});
  useEffect(() => { if (signedIn) reload(); }, [signedIn]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api.addContact({ name, phone: phone.replace(/[\s()-]/g, '') });
      setName('');
      setPhone('+7');
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the contact.');
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === false) return <Redirect href="/sign-in" />;
  if (signedIn === null) return <Screen><Body muted>Loading…</Body></Screen>;

  return (
    <Screen>
      <Title>Trusted contact</Title>
      <Body muted>The person who is alerted if you are late or in trouble. Choose someone who can act: call you, call others, call 112.</Body>

      {contacts.map((c) => (
        <Card key={c.id} tone="ok">
          <Body>{c.name}</Body>
          <Body muted>{c.phone}</Body>
          <Button title="Remove" variant="secondary" onPress={async () => { await api.removeContact(c.id); reload(); }} />
        </Card>
      ))}

      <View style={{ gap: 12 }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Aigerim (sister)" />
        <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+77011234567" keyboardType="phone-pad" />
        <ErrorText message={error} />
        <Button title="Save contact" busy={busy} onPress={add} />
      </View>
    </Screen>
  );
}
