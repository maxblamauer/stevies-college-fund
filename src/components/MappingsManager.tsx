import { useEffect, useState } from 'react';

const API = '/api';

interface Mapping {
  id: number;
  merchant_pattern: string;
  category: string;
}

export function MappingsManager() {
  const [mappings, setMappings] = useState<Mapping[]>([]);

  const fetchMappings = async () => {
    const res = await fetch(`${API}/category-mappings`);
    setMappings(await res.json());
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const deleteMapping = async (id: number) => {
    await fetch(`${API}/category-mappings/${id}`, { method: 'DELETE' });
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
                <td><code>{m.merchant_pattern}</code></td>
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
