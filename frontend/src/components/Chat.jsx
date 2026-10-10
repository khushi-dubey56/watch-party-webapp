import { useEffect, useRef, useState } from 'react';

export default function Chat({ messages, onSend, myId }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <section className="panel chat">
      <h3>Chat</h3>
      <div className="messages" ref={listRef}>
        {messages.map((m) =>
          m.system ? (
            <div key={m.id} className="msg system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.userId === myId ? 'mine' : ''}`}>
              <strong>{m.username}</strong>
              <span className={`badge ${m.role}`}>{m.role}</span>
              <div>{m.text}</div>
            </div>
          )
        )}
      </div>
      <div className="row">
        <input
          value={text}
          maxLength={500}
          placeholder="Type a message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button onClick={submit}>Send</button>
      </div>
    </section>
  );
}