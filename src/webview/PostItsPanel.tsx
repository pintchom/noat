import { useState } from 'react';
import { deletePostIt, openPostIt, usePostIts } from './post-its-client';

/** The post-its this note left around the code, each a link back to its spot. */
export function PostItsPanel() {
  const postIts = usePostIts();
  const [open, setOpen] = useState(true);
  if (postIts.length === 0) return null;

  return (
    <section className="noat-postits" aria-label="Post-its in code">
      <button
        type="button"
        className="noat-postits-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="noat-postits-caret">{open ? '\u25be' : '\u25b8'}</span>
        Post-its in code
        <span className="noat-postits-count">{postIts.length}</span>
      </button>
      {open && (
        <ul className="noat-postits-list">
          {postIts.map((postIt) => (
            <li key={postIt.id} className="noat-postit">
              <div className="noat-postit-head">
                <button
                  type="button"
                  className="noat-postit-location"
                  title="Show in code"
                  onClick={() => openPostIt(postIt.id)}
                >
                  {postIt.location}
                </button>
                <button
                  type="button"
                  className="noat-postit-delete"
                  aria-label="Delete post-it"
                  title="Delete post-it"
                  onClick={() => deletePostIt(postIt.id)}
                >
                  {'\u00d7'}
                </button>
              </div>
              {postIt.snippet && <pre className="noat-postit-snippet">{postIt.snippet}</pre>}
              <p className="noat-postit-text">{postIt.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
