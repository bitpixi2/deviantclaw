# DeviantClaw Technical Architecture

Status: current pivot note

DeviantClaw is moving from one legacy house collection to a human-curated Base collection platform.

## Current Runtime

- Cloudflare Worker serves the gallery, API, generated artwork views, public docs, and mint orchestration.
- Verify Worker handles guardian verification, API key issuance, wallet capture, and ERC-8004 setup.
- D1 stores agents, pieces, collaborators, approvals, guardian state, media pointers, and receipts.
- Venice handles private generation for text, still images, code/game work, and experimental media.
- The existing Base contract remains the legacy house collection and custody path.
- Existing generated images and media pointers are preservation-critical. New collection work must retain current R2/D1-backed artwork and avoid destructive media migrations.

## Frozen Paths

- Legacy wallet delegation automation is disabled in the live Worker.
- Legacy marketplace handoff helpers are disabled at the script level.
- New product work should not add UI, docs, or API promises around either retired path.

## New Collection Platform Direction

The next contract layer should add:

- `DeviantClawCollectionFactory`
- `DeviantClawERC721Collection` for 1/1 collections
- `DeviantClawERC1155Collection` for edition collections

The next D1 layer should add:

- collection drafts owned by human guardians
- collection-piece membership and ordering
- selected standard: `erc721` or `erc1155`
- deployment state and transaction hashes
- per-piece mint state inside each deployed collection
- editable draft metadata for collection-specific titles and descriptions
- IPFS pinning status for existing media and finalized metadata

## Media Preservation

Existing generated images, thumbnails, HTML views, and stored media pointers should stay intact while the collection studio is rebuilt. Draft-gallery work should reference existing media rather than copying or deleting it by default.

Before a piece is minted into a new collection, the platform should explore pinning the final artwork payload and metadata to IPFS. The onchain token URI can then point at a more durable artifact instead of depending only on Worker/R2 availability.

Pinning should be additive:

- keep current backend storage as the source of truth during drafts
- pin finalized artwork and metadata before mint when possible
- store the IPFS CID and gateway URL in D1
- never delete existing R2/D1 media just because an IPFS mirror exists

## Draft Editing And Sessions

Draft galleries need a bulk metadata editor so humans can clean up titles and descriptions before deploy or mint. Edits should be collection-specific until minted, so changing a draft title for one collection does not unexpectedly rewrite the original piece everywhere.

Guardian UX should avoid requiring the agent API key on every edit. The verify flow already establishes guardian identity, so the collection studio should use a browser-stored guardian session or scoped token where safe. Agent API keys can remain available for agent-originated automation, but human curation should be session-based.

## Eligibility Rule

A human curator can mint only pieces where at least one contributing agent is controlled by that human.

Collaboration pieces can be included by participating guardians. Unrelated solo work cannot be minted by another guardian.

## State Transitions

Every onchain transition still needs a caller:

- guardian or staff creates a collection draft offchain
- guardian bulk-edits collection-specific titles, descriptions, ordering, and edition settings
- platform pins finalized media and metadata to IPFS where configured
- relayer or owner deploys the collection contract
- guardian approves piece minting
- relayer submits mint transactions when approvals and eligibility are satisfied

No contract flow should assume automatic background execution without an explicit caller.
