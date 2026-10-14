<script setup lang="ts">
/**
 * The "Ask us" button and chat panel on customer pages (never in the staff portal). The chat store
 * does the answering; every free time it lists is a link into booking with the details filled in.
 * Native <dialog>: bottom sheet on phones, a panel in the corner on larger screens.
 */
import { computed, nextTick, ref, watch } from 'vue';
import Icon from './Icon.vue';
import { useCatalog } from '@/stores/catalog';
import { useChat } from '@/stores/chat';

defineProps<{ raised?: boolean }>();

const chat = useChat();
const catalog = useCatalog();
const dialog = ref<HTMLDialogElement | null>(null);
const log = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const open = ref(false);
const text = ref('');

const lastBot = computed(() => [...chat.messages].reverse().find((m) => m.from === 'bot'));
const hasNotice = computed(() => {
  const notice = catalog.data?.notice;
  return !!notice && notice.until >= catalog.today;
});

function show() {
  open.value = true;
  dialog.value?.showModal();
  chat.start();
  nextTick(() => input.value?.focus());
}

function close() {
  dialog.value?.close();
}

function onBackdrop(e: MouseEvent) {
  if (e.target === dialog.value) close();
}

function send() {
  const question = text.value;
  text.value = '';
  chat.send(question);
}

/** Show a new answer from its first line (it can be long); everything else scrolls to the bottom. */
watch(
  () => [chat.messages.length, chat.busy],
  async () => {
    await nextTick();
    const el = log.value;
    if (!el) return;
    const lastUser = chat.messages.map((m) => m.from).lastIndexOf('user');
    const firstReply = chat.messages[lastUser + 1];
    const target = !chat.busy && lastUser >= 0 && firstReply ? el.querySelector<HTMLElement>(`[data-id="${firstReply.id}"]`) : null;
    el.scrollTop = target ? target.offsetTop - 12 : el.scrollHeight;
  },
);
</script>

<template>
  <button
    v-show="!open"
    type="button"
    class="chat-fab"
    :class="{ raised }"
    aria-haspopup="dialog"
    aria-label="Ask us about hours, free times and prices"
    @click="show"
  >
    <Icon name="chat" :size="24" />
    <span class="fab-label" aria-hidden="true">Ask us</span>
    <span v-if="hasNotice" class="fab-dot" aria-hidden="true" />
  </button>

  <dialog ref="dialog" class="chat" aria-labelledby="chat-title" @close="open = false" @click="onBackdrop">
    <div class="chat-frame">
      <header class="chat-head">
        <img class="chat-logo" src="/brand/logo.png" srcset="/brand/logo@2x.png 2x" width="36" height="36" alt="" />
        <div class="chat-titles">
          <h2 id="chat-title" class="chat-title">{{ catalog.settings?.shopName ?? 'Top Notch Dog Grooming' }}</h2>
          <p class="small muted">Ask about hours, free times and prices</p>
        </div>
        <button type="button" class="icon-btn" aria-label="Close chat" @click="close"><Icon name="x" /></button>
      </header>

      <div ref="log" class="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        <div v-for="m in chat.messages" :key="m.id" :data-id="m.id" class="msg" :class="m.from">
          <div class="bubble">
            <span class="visually-hidden">{{ m.from === 'bot' ? 'Assistant:' : 'You:' }}</span>
            <p v-for="(line, i) in m.lines" :key="i">{{ line }}</p>
            <dl v-if="m.rows?.length" class="rows">
              <template v-for="r in m.rows" :key="r.label">
                <dt>{{ r.label }}</dt>
                <dd class="tabular">{{ r.value }}</dd>
              </template>
            </dl>
            <div v-if="m.slots?.length" class="slots">
              <RouterLink v-for="s in m.slots" :key="s.label" :to="s.to" class="slot tabular" @click="close">{{ s.label }}</RouterLink>
            </div>
            <div v-if="m.links?.length" class="links">
              <template v-for="l in m.links" :key="l.label">
                <a v-if="l.href" :href="l.href" class="btn btn-sm">{{ l.label }}</a>
                <RouterLink v-else-if="l.to" :to="l.to" class="btn btn-sm" @click="close">{{ l.label }}</RouterLink>
              </template>
            </div>
          </div>
          <div v-if="m === lastBot && m.choices?.length && !chat.busy" class="choices" role="group" aria-label="Suggested questions">
            <button v-for="c in m.choices" :key="c.label" type="button" class="choice" @click="chat.choose(c)">{{ c.label }}</button>
          </div>
        </div>
        <div v-if="chat.busy" class="msg bot">
          <div class="bubble typing">
            <span class="visually-hidden">Checking…</span>
            <i /><i /><i />
          </div>
        </div>
      </div>

      <form class="chat-form" @submit.prevent="send">
        <label for="chat-text" class="visually-hidden">Type your question</label>
        <input
          id="chat-text"
          ref="input"
          v-model="text"
          class="input"
          type="text"
          autocomplete="off"
          enterkeyhint="send"
          maxlength="200"
          placeholder="e.g. May slot ba bukas?"
        />
        <button type="submit" class="send" :disabled="!text.trim() || chat.busy" aria-label="Send"><Icon name="send" :size="20" /></button>
      </form>
    </div>
  </dialog>
</template>

<style scoped>
.chat-fab {
  position: fixed;
  /* Above the tab bar, below toasts. */
  z-index: 25;
  right: 16px;
  bottom: calc(var(--nav-h) + var(--safe-b) + 16px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--paper);
  font: inherit;
  font-weight: 680;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.2);
  cursor: pointer;
}

/* Clears the sticky action bar on the open-times page. */
.chat-fab.raised {
  bottom: calc(var(--nav-h) + var(--safe-b) + 92px);
}

.fab-label {
  display: none;
}

.fab-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--brand);
  border: 2px solid var(--ink);
}

@media (min-width: 900px) {
  .chat-fab {
    right: 24px;
    bottom: 24px;
    width: auto;
    padding: 0 20px 0 16px;
  }
  .chat-fab.raised {
    bottom: 100px;
  }
  .fab-label {
    display: inline;
  }
}

.chat {
  width: 100%;
  max-width: 100%;
  height: min(88dvh, 720px);
  max-height: 100dvh;
  margin: auto 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);
  color: var(--ink);
  overflow: hidden;
}

.chat[open] {
  animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.chat::backdrop {
  background: rgb(0 0 0 / 0.45);
}

.chat-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--grout);
}

.chat-logo {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex: none;
}

.chat-titles {
  flex: 1;
  min-width: 0;
}

.chat-title {
  font-size: var(--step-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-log {
  position: relative;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  display: grid;
  gap: 14px;
  align-content: start;
}

.msg {
  display: grid;
  gap: 8px;
  justify-items: start;
}

.msg.user {
  justify-items: end;
}

.bubble {
  display: grid;
  gap: 8px;
  width: fit-content;
  max-width: 92%;
  padding: 10px 14px;
  border-radius: 18px 18px 18px 6px;
  border: 1px solid var(--grout);
  background: var(--surface-sunk);
  overflow-wrap: anywhere;
}

.msg.user .bubble {
  max-width: 85%;
  border-radius: 18px 18px 6px 18px;
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}

.rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0;
  font-size: var(--step--1);
}

.rows dt {
  font-weight: 660;
}

.rows dd {
  margin: 0;
}

.slots,
.links,
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.slot {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--grout-strong);
  background: var(--brand-faint);
  color: var(--ink);
  font-weight: 660;
  text-decoration: none;
}

.slot:hover {
  border-color: var(--accent-ink);
}

.choice {
  appearance: none;
  min-height: 44px;
  padding: 0 14px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--grout-strong);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--step--1);
  font-weight: 620;
  cursor: pointer;
}

.choice:hover {
  background: var(--surface-sunk);
}

.typing {
  display: flex;
  gap: 5px;
  padding: 16px;
}

.typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-soft);
  animation: blink 1.2s infinite ease-in-out;
}

.typing i:nth-of-type(2) {
  animation-delay: 0.15s;
}

.typing i:nth-of-type(3) {
  animation-delay: 0.3s;
}

.chat-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 10px 12px calc(10px + var(--safe-b));
  border-top: 1px solid var(--grout);
}

.send {
  appearance: none;
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: var(--brand);
  color: var(--on-brand);
  cursor: pointer;
}

.send:disabled {
  background: var(--surface-sunk);
  color: var(--ink-soft);
  cursor: not-allowed;
}

@media (min-width: 640px) {
  .chat {
    width: 400px;
    height: min(640px, calc(100dvh - 48px));
    margin: auto 24px 24px auto;
    border-radius: var(--radius-sheet);
    border: 1px solid var(--grout);
  }
  .chat::backdrop {
    background: rgb(0 0 0 / 0.25);
  }
}

@keyframes rise {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}
</style>
