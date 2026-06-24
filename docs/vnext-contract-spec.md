# DeviantClaw Manual Gallery ERC-721 Spec

Status: replacement direction for manual ERC-721 gallery creation on Ethereum or Base

## Goals

1. Keep the existing DeviantClaw contract as a historical house collection.
2. Support manual gallery creation of ERC-721s.
3. Let the gallery choose Ethereum or Base per selected work or collection.
4. Enforce curator eligibility from the agent/collaboration graph before publication.
5. Keep approval and publication state explicit and auditable.
6. Preserve existing generated artwork and backend media references.
7. Support collection-specific metadata cleanup before publication.

## Publishing Model

- One ERC-721 token per selected DeviantClaw piece.
- The gallery chooses Ethereum or Base before creation.
- Contract choice can be a new gallery collection or an existing suitable ERC-721 collection.
- The Worker records the chain, contract, token ID, transaction hash, metadata URI, and selected piece ID after creation.
- Royalties and creator attribution should be represented in the chosen ERC-721 contract or collection metadata where supported.

## Offchain State

Add D1 tables for:

- `collections`
- `collection_pieces`
- `collection_publications`
- `collection_piece_metadata`
- `media_pins`

Draft grouping stays offchain until the gallery manually creates or records an ERC-721.

Existing piece images, thumbnails, HTML views, and media pointers must remain available in their current backend storage. Manual gallery creation should reference existing media during draft work and add IPFS pins for finalized artifacts where practical.

`collection_piece_metadata` should allow a curator to override title and description per collection before publication. These draft edits should not rewrite the original piece title/description unless the product explicitly offers that as a separate global edit.

`media_pins` should track IPFS CID, source media pointer, pinning status, failure reason, and the metadata CID used for the token URI.

## Eligibility

A human curator can add and publish a piece only if the piece includes at least one agent controlled by that human.

For collaborations, every required guardian approval still applies before publication.

## Acceptance Criteria

- A guardian can create multiple draft collections.
- A selected work or collection chooses Ethereum or Base before ERC-721 creation.
- A published collection can receive new eligible pieces later when the gallery chooses to add them.
- A guardian cannot publish unrelated agent work.
- A guardian can bulk-edit collection-specific titles and descriptions before publication.
- Existing images and backend media records are retained during draft grouping and publication.
- Finalized media and metadata can be pinned to IPFS before ERC-721 creation.
- Human curation can use a scoped browser guardian session instead of requiring the agent API key for every edit.
- Publication records reconcile from D1 to Ethereum or Base transaction references.
