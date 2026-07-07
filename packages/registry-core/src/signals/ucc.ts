import { fetchUccRelationships } from "../sources/colorado/ucc.js";
import type { FetchRetryOptions } from "../util/http.js";

export interface UccSignal {
  entityId: string;
  entityName: string;
  securedParties: string[];
  note: string;
}

// This is not a Signal in the trigger sense but supplementary dossier data
export async function fetchUccSignals(
  entities: Array<{ id: string; name: string }>,
  httpOpts: FetchRetryOptions = {}
): Promise<UccSignal[]> {
  const names = entities.map(e => e.name);
  const relationships = await fetchUccRelationships(names, httpOpts);

  return relationships
    .filter(r => r.securedParties.length > 0)
    .map(r => {
      const entity = entities.find(e =>
        e.name.toUpperCase().replace(/[^A-Z0-9\s]/g, "").includes(
          r.entityName.toUpperCase().replace(/[^A-Z0-9\s]/g, "")
        )
      );
      const sp = r.securedParties;
      return {
        entityId: entity?.id ?? "",
        entityName: r.entityName,
        securedParties: sp,
        note: `UCC financing relationships found — secured parties: ${sp.slice(0, 3).join(", ")}${sp.length > 3 ? ` (+${sp.length - 3} more)` : ""}`,
      };
    });
}
