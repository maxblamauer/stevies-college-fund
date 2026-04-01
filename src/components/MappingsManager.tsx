import { useEffect, useState } from 'react';
import { collection, getDocs, deleteDoc, doc, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

interface Mapping {
  id: string;
  merchantPattern: string;
  category: string;
}

interface Props {
  householdId: string;
}

export function MappingsManager({ householdId }: Props) {
  const [mappings, setMappings] = useState<Mapping[]>([]);

  const fetchMappings = async () => {
    const q = query(collection(db, 'households', householdId, 'categoryMappings'), orderBy('merchantPattern'));
    const snap = await getDocs(q);
    setMappings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mapping)));
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const deleteMapping = async (id: string) => {
    await deleteDoc(doc(db, 'households', householdId, 'categoryMappings', id));
    fetchMappings();
  };

  return (
    <div className="mappings-page">
      <h2>Category Mappings</h2>
      <p className="hint">
        These are merchant-to-category rules that the app remembers. When you confirm or edit
        a transaction's category, the merchant pattern is saved here. Future uploads will
        auto-match these patterns.
      </p>

      {mappings.length === 0 ? (
        <p className="empty-state">
          No custom mappings yet. Confirm or edit transaction categories to build your mapping rules.
        </p>
      ) : (
        <table className="mappings-table">
          <thead>
            <tr>
              <th>Merchant Pattern</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td><code>{m.merchantPattern}</code></td>
                <td>{m.category}</td>
                <td>
                  <button className="btn btn-xs btn-danger" onClick={() => deleteMapping(m.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
