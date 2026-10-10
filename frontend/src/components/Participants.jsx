export default function Participants({ participants, myId, isHost, onAssign, onRemove, onTransfer }) {
  return (
    <section className="panel">
      <h3>Participants ({participants.length})</h3>
      <ul className="people">
        {participants.map((p) => (
          <li key={p.userId}>
            <div className="personTop">
              <span className="name">
                {p.username}
                {p.userId === myId && <span className="muted"> (you)</span>}
              </span>
              <span className={`badge ${p.role}`}>{p.role}</span>
            </div>
            {isHost && p.userId !== myId && (
              <div className="actions">
                <select value={p.role} onChange={(e) => onAssign(p.userId, e.target.value)}>
                  <option value="participant">Participant</option>
                  <option value="moderator">Moderator</option>
                </select>
                <button className="ghost small" onClick={() => onTransfer(p)}>
                  Make host
                </button>
                <button className="danger small" onClick={() => onRemove(p)}>
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}