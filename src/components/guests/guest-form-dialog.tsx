'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Link2, Loader2, Search, User, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import type { GuestLinkedContact, GuestWithContact } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface GuestFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create; otherwise edit this guest. */
  guest: GuestWithContact | null;
  /** Called with the saved guest so the parent can refresh its view. */
  onSaved: (guest: GuestWithContact) => void;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  is_vip: boolean;
  tagsText: string;
  dietary_notes: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  phone: '',
  email: '',
  is_vip: false,
  tagsText: '',
  dietary_notes: '',
  notes: '',
};

function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function GuestFormDialog({
  open,
  onOpenChange,
  guest,
  onSaved,
}: GuestFormDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [linkedContact, setLinkedContact] = useState<GuestLinkedContact | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  // Contact picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<GuestLinkedContact[]>(
    []
  );
  const [searching, setSearching] = useState(false);

  // Reset the form whenever the dialog opens for a (different) guest.
  useEffect(() => {
    if (!open) return;
    if (guest) {
      setForm({
        name: guest.name,
        phone: guest.phone ?? '',
        email: guest.email ?? '',
        is_vip: guest.is_vip,
        tagsText: guest.tags.join(', '),
        dietary_notes: guest.dietary_notes ?? '',
        notes: guest.notes ?? '',
      });
      setLinkedContact(guest.contact);
    } else {
      setForm(EMPTY_FORM);
      setLinkedContact(null);
    }
    setContactQuery('');
    setContactResults([]);
  }, [open, guest]);

  const runContactSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setContactResults([]);
        return;
      }
      setSearching(true);
      try {
        const { data, error } = await supabase
          .from('contacts')
          .select('id, name, phone, avatar_url')
          .or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`)
          .order('name', { ascending: true })
          .limit(8);
        if (error) throw error;
        setContactResults((data as GuestLinkedContact[]) ?? []);
      } catch (err) {
        console.error(err);
        setContactResults([]);
      } finally {
        setSearching(false);
      }
    },
    [supabase]
  );

  // Debounce the contact search.
  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => void runContactSearch(contactQuery), 250);
    return () => clearTimeout(t);
  }, [contactQuery, pickerOpen, runContactSearch]);

  function linkContact(contact: GuestLinkedContact) {
    setLinkedContact(contact);
    // Prefill identity from the contact where the guest fields are empty.
    setForm((f) => ({
      ...f,
      name: f.name.trim() || contact.name || '',
      phone: f.phone.trim() || contact.phone || '',
    }));
    setPickerOpen(false);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contact_id: linkedContact?.id ?? null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        is_vip: form.is_vip,
        dietary_notes: form.dietary_notes.trim() || null,
        notes: form.notes.trim() || null,
        tags: parseTags(form.tagsText),
      };
      const res = await fetch(
        guest ? `/api/guests/${guest.id}` : '/api/guests',
        {
          method: guest ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      const json = (await res.json()) as { guest: GuestWithContact };
      toast.success(guest ? 'Guest updated.' : 'Guest added.');
      onSaved(json.guest);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save guest.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const previewTags = parseTags(form.tagsText);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover text-popover-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{guest ? 'Edit guest' : 'Add guest'}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {guest
              ? "Update this guest's details."
              : 'Add a diner. Optionally link their WhatsApp contact.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contact link */}
          <div className="space-y-1.5">
            <Label>WhatsApp contact</Label>
            {linkedContact ? (
              <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2">
                <User className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {linkedContact.name || 'Unnamed contact'}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {linkedContact.phone}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Unlink contact"
                  onClick={() => setLinkedContact(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                    >
                      <Link2 className="size-4" />
                      Link a contact
                    </Button>
                  }
                />
                <PopoverContent
                  className="w-(--anchor-width) p-0"
                  align="start"
                >
                  <div className="border-border relative border-b">
                    <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                    <Input
                      autoFocus
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      placeholder="Search contacts by name or phone..."
                      className="border-0 pl-8 focus-visible:ring-0"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1">
                    {searching ? (
                      <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                        <Loader2 className="size-4 animate-spin" />
                        Searching…
                      </div>
                    ) : contactResults.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                        {contactQuery.trim()
                          ? 'No contacts found.'
                          : 'Type to search contacts.'}
                      </p>
                    ) : (
                      contactResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => linkContact(c)}
                          className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left"
                        >
                          <User className="text-muted-foreground size-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-sm">
                              {c.name || 'Unnamed contact'}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {c.phone}
                            </span>
                          </span>
                          <Check className="text-muted-foreground/0 size-4" />
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-name">Name</Label>
            <Input
              id="guest-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Guest name"
              className="bg-muted"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="guest-phone">Phone</Label>
              <Input
                id="guest-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="Optional"
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-email">Email</Label>
              <Input
                id="guest-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="Optional"
                className="bg-muted"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-tags">
              Tags
              <span className="text-muted-foreground text-xs font-normal">
                comma-separated
              </span>
            </Label>
            <Input
              id="guest-tags"
              value={form.tagsText}
              onChange={(e) =>
                setForm((f) => ({ ...f, tagsText: e.target.value }))
              }
              placeholder="e.g. regular, wine-club, birthday"
              className="bg-muted"
            />
            {previewTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {previewTags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-dietary">Dietary notes / allergies</Label>
            <Textarea
              id="guest-dietary"
              value={form.dietary_notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, dietary_notes: e.target.value }))
              }
              placeholder="e.g. Nut allergy, vegetarian"
              className="bg-muted min-h-[60px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-notes">Notes</Label>
            <Textarea
              id="guest-notes"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              placeholder="Anything worth remembering about this guest."
              className="bg-muted min-h-[60px]"
            />
          </div>

          <div className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
            <Label htmlFor="guest-vip" className="cursor-pointer">
              VIP
              <span className="text-muted-foreground text-xs font-normal">
                Flag this guest for special attention
              </span>
            </Label>
            <Switch
              id="guest-vip"
              checked={form.is_vip}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, is_vip: checked }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {guest ? 'Save changes' : 'Add guest'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
