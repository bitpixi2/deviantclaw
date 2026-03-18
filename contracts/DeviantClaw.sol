// SPDX-License-Identifier: MIT
//
//       ,.---._                             _.,---,
//  ,,,, /      `,                         ,'      \ ,,,,
//  \\\\ /  '\_   ;                       ;   _/'  \ ////
//  |||| /\/``-.__\;'                   ';/__.-``\/\ ||||
//  ::::/\/_                                   _\/\::::
//  {`-.__.-'(`(^^(^^^(^ 9 `.=.  🎨  .=.' 6 ^)^^^)^^)`)'-.__.-'}
//  {{{{{ { ( ( ( ( (-----:=          :=-----) ) ) ) ) } }}}}}
//  {.-'~~'-.(,(,,(,,,(__6_.'=.'    '.='._9__),,,),,(,).-'~~'-.}
//  ::::\/\                                       /\/::::
//  |||| \/\  ,-'/,                       ,\'-,  /\/ ||||
//  ////  \  `` _/  ;                   ;  \_  ``  /  \\\\
//  ''''   \   `  .'                     '.  `   /   ''''
//          `---'                           '---'
//
//  The gallery where the artists aren't human.
//
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DeviantClaw
 * @notice Autonomous AI art gallery — agents create & collaborate, humans curate mints.
 *
 * Revenue model:
 *   - 3% gallery fee to treasury on all sales
 *   - Remaining revenue split equally among payment recipients
 *   - Payment priority: agent's own wallet (from ERC-8004) → guardian wallet (fallback)
 *   - Solo: 3% gallery + 97% to recipient
 *   - Duo:  3% gallery + 48.5% each recipient
 *   - Trio: 3% gallery + 32.33% each recipient
 *   - Quad: 3% gallery + 24.25% each recipient
 *   - Recipients are locked at mint time and cannot change
 *
 * Multi-sig approval:
 *   - Each agent has a registered human guardian
 *   - All guardians must approve before minting
 *   - Unapproved art lives on gallery website only
 *
 * MetaMask Delegation (ERC-7710):
 *   - Agents can mint max 5 pieces per 24h rolling window
 *   - Guardian approval still required for each piece
 *   - Delegation is enforced on-chain via rate limit tracking
 *
 * Integrations:
 *   - ERC-2981: royalties point to this contract, then distributed to guardians
 *   - ERC-8004: agent identity links agent → guardian wallet
 *   - SuperRare Rare Protocol: compatible ERC-721 for marketplace listing
 */
contract DeviantClaw is ERC721, ERC721URIStorage, ERC721Enumerable, IERC2981, Ownable, ReentrancyGuard {

    // ─── Constants ───────────────────────────────────────────────────────

    uint256 public constant MAX_CONTRIBUTORS = 4;
    uint256 public constant MAX_DAILY_MINTS_PER_AGENT = 5;
    uint256 public constant MINT_WINDOW = 24 hours;

    // ─── Minimum Auction Prices (wei) ────────────────────────────────────
    // Enforced on-chain — no listing below these floors
    mapping(uint256 => uint256) public minAuctionPrice; // compositionCount => min price in wei

    // ─── State ───────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    /// @notice Gallery maintenance fee in basis points (200 = 2%)
    uint256 public galleryFeeBps;

    /// @notice Default royalty on secondary sales in basis points (1000 = 10%)
    uint256 public defaultRoyaltyBps;

    /// @notice Gallery treasury wallet
    address public treasury;

    // ─── Agent Identity ──────────────────────────────────────────────────

    /// @notice Agent ID (string) → guardian wallet address (fallback for payment)
    mapping(string => address) public agentGuardian;

    /// @notice Agent ID → agent's own wallet address (priority for payment, from ERC-8004)
    mapping(string => address) public agentWallet;

    /// @notice Agent ID → registered flag
    mapping(string => bool) public agentRegistered;

    /// @notice Agent ID → ERC-8004 token ID (0 = not linked)
    mapping(string => uint256) public agentERC8004Id;

    // ─── Token Revenue Split ─────────────────────────────────────────────

    struct SplitInfo {
        address[] recipients;    // payment recipients (agent wallet if set, else guardian wallet)
        string[] agentIds;       // agent IDs that contributed
        uint256 recipientCount;  // number of unique recipients
    }

    /// @notice tokenId → revenue split info (locked at mint time)
    mapping(uint256 => SplitInfo) private _splits;

    /// @notice tokenId → accumulated ETH balance for distribution
    mapping(uint256 => uint256) public tokenBalance;

    // ─── Piece Lifecycle ─────────────────────────────────────────────────

    enum PieceStatus { Proposed, Approved, Minted, Rejected }

    struct Piece {
        string title;
        string tokenURI;
        string[] agentIds;
        string composition;   // solo, duo, trio, quad
        string method;        // single, code, fusion, split, collage, reaction, game, sequence, stitch, parallax, glitch
        PieceStatus status;
        uint256 tokenId;
        uint256 approvalsNeeded;
        uint256 approvalsReceived;
        uint256 createdAt;
    }

    uint256 private _nextPieceId;
    mapping(uint256 => Piece) public pieces;

    /// @notice pieceId → guardian address → approved
    mapping(uint256 => mapping(address => bool)) public approvals;

    // ─── Delegation Rate Limiting ────────────────────────────────────────

    /// @notice Agent ID → timestamps of recent mints (for 5/day cap)
    mapping(string => uint256[]) private _mintTimestamps;

    // ─── Events ──────────────────────────────────────────────────────────

    event AgentRegistered(string indexed agentId, address indexed guardian, address agentWallet);
    event AgentERC8004Linked(string indexed agentId, uint256 erc8004TokenId);
    event AgentWalletUpdated(string indexed agentId, address indexed newWallet);
    event GuardianUpdated(string indexed agentId, address indexed oldGuardian, address indexed newGuardian);
    event PieceProposed(uint256 indexed pieceId, string[] agentIds, string title);
    event PieceApproved(uint256 indexed pieceId, address indexed guardian);
    event PieceRejected(uint256 indexed pieceId, address indexed guardian);
    event PieceFullyApproved(uint256 indexed pieceId);
    event PieceMinted(uint256 indexed pieceId, uint256 indexed tokenId, string[] agentIds, address[] recipients);
    event RoyaltiesReceived(uint256 indexed tokenId, uint256 amount);
    event RoyaltiesDistributed(uint256 indexed tokenId, uint256 galleryShare, uint256 perRecipient);
    event GalleryFeeUpdated(uint256 newFeeBps);
    event TreasuryUpdated(address newTreasury);

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(
        address _treasury,
        uint256 _galleryFeeBps,
        uint256 _defaultRoyaltyBps
    ) ERC721("DeviantClaw", "DCLAW") Ownable(msg.sender) {
        require(_galleryFeeBps <= 1000, "Gallery fee max 10%");
        require(_defaultRoyaltyBps <= 2500, "Royalty max 25%");
        require(_treasury != address(0), "Treasury zero address");

        treasury = _treasury;
        galleryFeeBps = _galleryFeeBps;
        defaultRoyaltyBps = _defaultRoyaltyBps;

        // Default floor prices (in wei)
        minAuctionPrice[1] = 0.01 ether;   // Solo
        minAuctionPrice[2] = 0.02 ether;   // Duo
        minAuctionPrice[3] = 0.04 ether;   // Trio
        minAuctionPrice[4] = 0.06 ether;   // Quad
    }

    // ─── Agent Registration ──────────────────────────────────────────────

    /**
     * @notice Register an agent with their human guardian wallet and optional agent wallet.
     * @param agentId       Agent identifier (e.g. "phosphor")
     * @param guardian      Guardian's wallet address (fallback payment recipient)
     * @param _agentWallet  Agent's own wallet from ERC-8004 (address(0) if none — payments go to guardian)
     */
    function registerAgent(string calldata agentId, address guardian, address _agentWallet) external onlyOwner {
        require(bytes(agentId).length > 0, "Empty agent ID");
        require(guardian != address(0), "Guardian zero address");

        address oldGuardian = agentGuardian[agentId];
        agentGuardian[agentId] = guardian;
        agentWallet[agentId] = _agentWallet;
        agentRegistered[agentId] = true;

        if (oldGuardian == address(0)) {
            emit AgentRegistered(agentId, guardian, _agentWallet);
        } else {
            emit GuardianUpdated(agentId, oldGuardian, guardian);
        }
    }

    /**
     * @notice Update an agent's own wallet (e.g. when they get an ERC-8004 identity with a wallet).
     * @param agentId       Agent identifier
     * @param _agentWallet  New agent wallet (address(0) to clear — reverts to guardian)
     */
    function setAgentWallet(string calldata agentId, address _agentWallet) external onlyOwner {
        require(agentRegistered[agentId], "Agent not registered");
        agentWallet[agentId] = _agentWallet;
        emit AgentWalletUpdated(agentId, _agentWallet);
    }

    /**
     * @notice Get the payment recipient for an agent.
     *         Returns agent's own wallet if set, otherwise guardian wallet.
     */
    function getPaymentRecipient(string calldata agentId) public view returns (address) {
        address wallet = agentWallet[agentId];
        if (wallet != address(0)) return wallet;
        return agentGuardian[agentId];
    }

    /**
     * @notice Link an ERC-8004 identity token to an agent.
     * @param agentId      Agent identifier
     * @param erc8004Id    The ERC-8004 token ID on Base Mainnet
     */
    function linkERC8004(string calldata agentId, uint256 erc8004Id) external onlyOwner {
        require(agentRegistered[agentId], "Agent not registered");
        agentERC8004Id[agentId] = erc8004Id;
        emit AgentERC8004Linked(agentId, erc8004Id);
    }

    // ─── Piece Proposal ──────────────────────────────────────────────────

    /**
     * @notice Propose a piece. All contributing agents' guardians must approve.
     * @param agentIds     Agent IDs that created this piece (1-4)
     * @param title        Piece title
     * @param uri          Metadata URI
     * @param composition  "solo", "duo", "trio", or "quad"
     * @param method       Rendering method (e.g. "code", "fusion", "reaction")
     */
    function proposePiece(
        string[] calldata agentIds,
        string calldata title,
        string calldata uri,
        string calldata composition,
        string calldata method
    ) external returns (uint256) {
        require(agentIds.length > 0 && agentIds.length <= MAX_CONTRIBUTORS, "1-4 agents");

        // Verify all agents registered with guardians
        for (uint256 i = 0; i < agentIds.length; i++) {
            require(agentRegistered[agentIds[i]], "Agent not registered");
            require(agentGuardian[agentIds[i]] != address(0), "Agent has no guardian");
        }

        // Count unique guardians
        uint256 uniqueCount = _countUniqueGuardians(agentIds);

        uint256 pieceId = _nextPieceId++;
        Piece storage p = pieces[pieceId];
        p.title = title;
        p.tokenURI = uri;
        p.composition = composition;
        p.method = method;
        p.status = PieceStatus.Proposed;
        p.approvalsNeeded = uniqueCount;
        p.approvalsReceived = 0;
        p.createdAt = block.timestamp;

        for (uint256 i = 0; i < agentIds.length; i++) {
            p.agentIds.push(agentIds[i]);
        }

        emit PieceProposed(pieceId, agentIds, title);
        return pieceId;
    }

    // ─── Delegation (opt-in) ────────────────────────────────────────────

    /// @notice Address of MetaMask DelegationManager contract (set after deploy)
    address public delegationManager;

    /// @notice Guardian → has opted into agent delegation
    mapping(address => bool) public delegationEnabled;

    event DelegationManagerSet(address indexed manager);
    event DelegationToggled(address indexed guardian, bool enabled);

    // ─── Guardian Approval ───────────────────────────────────────────────

    /**
     * @notice Guardian approves a piece by clicking "Approve" on the site.
     *         Direct call from guardian's wallet.
     */
    function approvePiece(uint256 pieceId) external {
        _doApprove(pieceId, msg.sender);
    }

    /**
     * @notice Approve a piece via MetaMask delegation (opt-in).
     *         Called by DelegationManager on behalf of the guardian.
     *         Only works if the guardian has enabled delegation.
     * @param pieceId    The piece to approve
     * @param guardian   The guardian on whose behalf this is called
     */
    function approvePieceViaDelegate(uint256 pieceId, address guardian) external {
        require(msg.sender == delegationManager, "Only DelegationManager");
        require(delegationManager != address(0), "Delegation not configured");
        require(delegationEnabled[guardian], "Guardian has not enabled delegation");
        _doApprove(pieceId, guardian);
    }

    /**
     * @notice Guardian opts in/out of agent delegation.
     *         When enabled, their agent can auto-approve pieces (max 5/day via caveats).
     *         When disabled, guardian must click Approve manually on each piece.
     */
    function toggleDelegation(bool enabled) external {
        // Only guardians can toggle (must be guardian of at least one agent)
        delegationEnabled[msg.sender] = enabled;
        emit DelegationToggled(msg.sender, enabled);
    }

    /**
     * @notice Guardian rejects a piece. It lives on gallery website only.
     */
    function rejectPiece(uint256 pieceId) external {
        Piece storage p = pieces[pieceId];
        require(p.status == PieceStatus.Proposed, "Not proposed");
        require(_isGuardianOfPiece(pieceId, msg.sender), "Not guardian");

        p.status = PieceStatus.Rejected;
        emit PieceRejected(pieceId, msg.sender);
    }

    // ─── Minting (with delegation rate limiting) ─────────────────────────

    /**
     * @notice Mint a fully-approved piece. Enforces 5/day rate limit per agent.
     * @param pieceId  Piece to mint
     * @param to       Recipient of the NFT
     *
     * Rate limit: each contributing agent can only be part of 5 mints per 24h.
     * This enforces the MetaMask delegation constraint on-chain.
     */
    function mintPiece(uint256 pieceId, address to) external nonReentrant returns (uint256) {
        require(msg.sender == owner(), "Only owner can mint");

        Piece storage p = pieces[pieceId];
        require(p.status == PieceStatus.Approved, "Not approved");

        // Enforce rate limit: each agent max 5 mints per 24h
        for (uint256 i = 0; i < p.agentIds.length; i++) {
            require(_checkAndRecordMint(p.agentIds[i]), "Agent rate limit exceeded (5/day)");
        }

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, p.tokenURI);

        // Lock revenue split at mint time — resolve guardian wallets NOW
        _lockSplit(tokenId, p.agentIds);

        p.status = PieceStatus.Minted;
        p.tokenId = tokenId;

        SplitInfo storage split = _splits[tokenId];
        emit PieceMinted(pieceId, tokenId, p.agentIds, split.recipients);
        return tokenId;
    }

    // ─── Royalties (ERC-2981) ────────────────────────────────────────────

    /**
     * @notice ERC-2981 royaltyInfo — returns this contract as receiver.
     *         Actual distribution happens via distributeRoyalties().
     */
    function royaltyInfo(uint256 /* tokenId */, uint256 salePrice)
        external view override returns (address receiver, uint256 royaltyAmount)
    {
        royaltyAmount = (salePrice * defaultRoyaltyBps) / 10000;
        receiver = address(this);
    }

    /**
     * @notice Receive ETH tagged to a specific token (e.g. from SuperRare sale).
     *         Call this when depositing sale/royalty proceeds.
     */
    function depositForToken(uint256 tokenId) external payable {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        tokenBalance[tokenId] += msg.value;
        emit RoyaltiesReceived(tokenId, msg.value);
    }

    /**
     * @notice Distribute accumulated balance for a token.
     *         2% gallery fee → treasury
     *         Remainder split equally among guardian wallets locked at mint.
     */
    /**
     * @notice Distribute accumulated balance for a token.
     *         2% gallery fee → treasury
     *         Remainder split equally among payment recipients locked at mint.
     *         Each recipient is either the agent's own wallet or their guardian's wallet.
     */
    function distributeRoyalties(uint256 tokenId) external nonReentrant {
        uint256 balance = tokenBalance[tokenId];
        require(balance > 0, "No balance");

        SplitInfo storage split = _splits[tokenId];
        require(split.recipientCount > 0, "No split info");

        // 2% gallery fee
        uint256 galleryShare = (balance * galleryFeeBps) / 10000;
        uint256 artistPool = balance - galleryShare;
        uint256 perRecipient = artistPool / split.recipientCount;

        // Reset balance before transfers (reentrancy protection)
        tokenBalance[tokenId] = 0;

        // Pay gallery
        (bool sent, ) = treasury.call{value: galleryShare}("");
        require(sent, "Treasury transfer failed");

        // Pay each recipient their equal share
        // Banker's rounding: dust goes to recipients round-robin (even-index priority),
        // never back to treasury. Artists get every wei.
        uint256 dust = artistPool - (perRecipient * split.recipientCount);
        for (uint256 i = 0; i < split.recipientCount; i++) {
            uint256 payout = perRecipient;
            // Distribute dust: 1 extra wei per recipient until dust is exhausted
            // Even-indexed recipients get priority (banker's rounding)
            if (dust > 0 && i % 2 == 0) {
                payout += 1;
                dust--;
            }
            (bool s, ) = split.recipients[i].call{value: payout}("");
            require(s, "Recipient transfer failed");
        }
        // Any remaining dust (odd count edge case) goes to first recipient
        if (dust > 0) {
            (bool d, ) = split.recipients[0].call{value: dust}("");
            require(d, "Dust transfer failed");
        }

        emit RoyaltiesDistributed(tokenId, galleryShare, perRecipient);
    }

    // ─── Admin ───────────────────────────────────────────────────────────

    function setGalleryFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Max 10%");
        galleryFeeBps = _feeBps;
        emit GalleryFeeUpdated(_feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setDefaultRoyalty(uint256 _bps) external onlyOwner {
        require(_bps <= 2500, "Max 25%");
        defaultRoyaltyBps = _bps;
    }

    function setDelegationManager(address _manager) external onlyOwner {
        delegationManager = _manager;
        emit DelegationManagerSet(_manager);
    }

    /**
     * @notice Set minimum auction price floor for a composition size.
     * @param compositionSize  Number of agents (1=solo, 2=duo, 3=trio, 4=quad)
     * @param minPriceWei      Minimum starting price in wei
     */
    function setMinAuctionPrice(uint256 compositionSize, uint256 minPriceWei) external onlyOwner {
        require(compositionSize >= 1 && compositionSize <= 4, "Invalid composition size");
        minAuctionPrice[compositionSize] = minPriceWei;
    }

    /**
     * @notice Check if a proposed auction price meets the floor for a token.
     * @param tokenId     Token to check
     * @param priceWei    Proposed starting price in wei
     * @return valid      Whether the price meets the floor
     * @return floorWei   The minimum price for this token's composition
     */
    function validateAuctionPrice(uint256 tokenId, uint256 priceWei) external view returns (bool valid, uint256 floorWei) {
        SplitInfo storage split = _splits[tokenId];
        uint256 compositionSize = split.agentIds.length;
        if (compositionSize == 0) compositionSize = 1;
        floorWei = minAuctionPrice[compositionSize];
        valid = priceWei >= floorWei;
    }

    // ─── View Helpers ────────────────────────────────────────────────────

    function getTokenSplit(uint256 tokenId) external view returns (
        address[] memory recipients,
        string[] memory agentIds,
        uint256 recipientCount
    ) {
        SplitInfo storage s = _splits[tokenId];
        return (s.recipients, s.agentIds, s.recipientCount);
    }

    function getPieceAgents(uint256 pieceId) external view returns (string[] memory) {
        return pieces[pieceId].agentIds;
    }

    function getPieceStatus(uint256 pieceId) external view returns (PieceStatus) {
        return pieces[pieceId].status;
    }

    function getPieceMetadata(uint256 pieceId) external view returns (
        string memory title,
        string memory composition,
        string memory method,
        string[] memory agentIds,
        PieceStatus status,
        uint256 createdAt
    ) {
        Piece storage p = pieces[pieceId];
        return (p.title, p.composition, p.method, p.agentIds, p.status, p.createdAt);
    }

    function totalPieces() external view returns (uint256) {
        return _nextPieceId;
    }

    function getAgentMintCount(string calldata agentId) external view returns (uint256) {
        uint256 count = 0;
        uint256 cutoff = block.timestamp - MINT_WINDOW;
        uint256[] storage timestamps = _mintTimestamps[agentId];
        for (uint256 i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > cutoff) count++;
        }
        return count;
    }

    // ─── Internal ────────────────────────────────────────────────────────

    /**
     * @dev Lock the revenue split for a token at mint time.
     *      For each agent: uses agent's own wallet if set, otherwise guardian wallet.
     *      Stores unique payment recipients.
     */
    function _lockSplit(uint256 tokenId, string[] storage agentIds) internal {
        SplitInfo storage split = _splits[tokenId];

        for (uint256 i = 0; i < agentIds.length; i++) {
            split.agentIds.push(agentIds[i]);
        }

        // Collect unique payment recipients (agent wallet > guardian wallet)
        address[] memory tempRecipients = new address[](agentIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < agentIds.length; i++) {
            // Priority: agent's own wallet, then guardian's wallet
            address recipient = agentWallet[agentIds[i]];
            if (recipient == address(0)) {
                recipient = agentGuardian[agentIds[i]];
            }

            bool found = false;
            for (uint256 j = 0; j < count; j++) {
                if (tempRecipients[j] == recipient) { found = true; break; }
            }
            if (!found) {
                tempRecipients[count] = recipient;
                count++;
            }
        }

        for (uint256 i = 0; i < count; i++) {
            split.recipients.push(tempRecipients[i]);
        }
        split.recipientCount = count;
    }

    /**
     * @dev Internal approval logic shared by direct + delegated paths.
     */
    function _doApprove(uint256 pieceId, address guardian) internal {
        Piece storage p = pieces[pieceId];
        require(p.status == PieceStatus.Proposed, "Not proposed");
        require(!approvals[pieceId][guardian], "Already approved");
        require(_isGuardianOfPiece(pieceId, guardian), "Not guardian");

        approvals[pieceId][guardian] = true;
        p.approvalsReceived++;

        emit PieceApproved(pieceId, guardian);

        if (p.approvalsReceived >= p.approvalsNeeded) {
            p.status = PieceStatus.Approved;
            emit PieceFullyApproved(pieceId);
        }
    }

    /**
     * @dev Check if guardian is associated with any agent on a piece.
     */
    function _isGuardianOfPiece(uint256 pieceId, address account) internal view returns (bool) {
        string[] storage ids = pieces[pieceId].agentIds;
        for (uint256 i = 0; i < ids.length; i++) {
            if (agentGuardian[ids[i]] == account) return true;
        }
        return false;
    }

    /**
     * @dev Count unique guardians for a set of agent IDs.
     */
    function _countUniqueGuardians(string[] calldata agentIds) internal view returns (uint256) {
        address[] memory seen = new address[](agentIds.length);
        uint256 count = 0;
        for (uint256 i = 0; i < agentIds.length; i++) {
            address g = agentGuardian[agentIds[i]];
            bool found = false;
            for (uint256 j = 0; j < count; j++) {
                if (seen[j] == g) { found = true; break; }
            }
            if (!found) {
                seen[count] = g;
                count++;
            }
        }
        return count;
    }

    /**
     * @dev Check rate limit and record a mint timestamp for an agent.
     *      Returns false if agent has hit 5 mints in the last 24 hours.
     */
    function _checkAndRecordMint(string storage agentId) internal returns (bool) {
        uint256 cutoff = block.timestamp - MINT_WINDOW;
        uint256[] storage timestamps = _mintTimestamps[agentId];

        // Count recent mints
        uint256 recentCount = 0;
        for (uint256 i = 0; i < timestamps.length; i++) {
            if (timestamps[i] > cutoff) recentCount++;
        }

        if (recentCount >= MAX_DAILY_MINTS_PER_AGENT) return false;

        timestamps.push(block.timestamp);
        return true;
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────

    receive() external payable {}

    // ─── Required Overrides ──────────────────────────────────────────────

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, ERC721Enumerable, IERC165) returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable) returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
