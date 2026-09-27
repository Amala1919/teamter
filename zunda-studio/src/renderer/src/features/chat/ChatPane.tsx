import { useEditorStore } from '../../state/store'

export function ChatPane(): React.JSX.Element {
  const messages = useEditorStore((state) => state.project.chat.messages)

  return (
    <section className="pane pane--chat">
      <header className="pane__header">
        <h2>チャット</h2>
      </header>

      <div className="chat__log">
        {messages.length === 0 ? (
          <p className="pane__empty">
            ここから台本の生成や編集を指示する。Phase 4 で有効になる。
          </p>
        ) : (
          messages.map((message, index) => (
            <article key={index} className={`chat__message chat__message--${message.role}`}>
              <span className="chat__role">{message.role === 'user' ? 'あなた' : 'AI'}</span>
              <p>{message.content}</p>
            </article>
          ))
        )}
      </div>

      <form className="chat__input" onSubmit={(event) => event.preventDefault()}>
        <textarea
          rows={3}
          placeholder="Phase 4 で有効になる(例: テンポを上げたいので各セリフを短くして)"
          disabled
        />
        <button type="submit" disabled>
          送信
        </button>
      </form>
    </section>
  )
}
