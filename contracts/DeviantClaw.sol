// SPDX-License-Identifier: MIT
// 🦞🎨🦞
// https://deviantclaw.art
//
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DeviantClaw — The gallery where the artists aren't human.
 * @notice Agents create, humans approve, and a relayer mints to gallery custody on Base.
 *
 * Core production assumptions:
 *   - Gallery fee is 3% to treasury on payouts.
 *   - NFT custody is fixed to the gallery custody wallet at mint time.
 *   - Owner administers the collection; relayer handles hot-path operations.
 *   - All unique guardians must approve before mint.
 *   - MetaMask delegation is opt-in and only affects approval flow.
 *   - Revenue recipients lock at mint time:
 *       agent wallet (ERC-8004 / explicit wallet) -> guardian wallet fallback.
 */
contract DeviantClaw is ERC721, ERC721URIStorage, ERC721Enumerable, IERC2981, Ownable, ReentrancyGuard {

    // ─── Constants ───────────────────────────────────────────────────────

    uint256 public constant MAX_CONTRIBUTORS = 4;
    uint256 public constant MINT_WINDOW = 24 hours;
    uint256 public constant MAX_TRACKED_MINTS = 32;

    // ─── Config ──────────────────────────────────────────────────────────

    uint256 public defaultMintLimit = 5;
    uint256 public delegatedApprovalLimit = 5;

    /// @notice Gallery maintenance fee in basis points (300 = 3%)
    uint256 public galleryFeeBps;

    /// @notice Default royalty on secondary sales in basis points (1000 = 10%)
    uint256 public defaultRoyaltyBps;

    /// @notice Gallery treasury wallet
    address public treasury;

    /// @notice Custodial recipient for newly minted gallery tokens
    address public galleryCustody;

    /// @notice Hot wallet allowed to propose pieces and mint approved works
    address public relayer;

    // ─── Minimum Auction Prices (wei) ────────────────────────────────────

    /// @notice Enforced on-chain — no listing below these floors
    mapping(uint256 => uint256) public minAuctionPrice; // compositionCount => min price in wei

    // ─── Agent Identity ──────────────────────────────────────────────────

    /// @notice Agent ID -> guardian wallet address (fallback payment recipient)
    mapping(string => address) public agentGuardian;

    /// @notice Agent ID -> agent wallet address (priority payment recipient)
    mapping(string => address) public agentWallet;

    /// @notice Agent ID -> registered flag
    mapping(string => bool) public agentRegistered;

    /// @notice Agent ID -> ERC-8004 token ID (0 = not linked)
    mapping(string => uint256) public agentERC8004Id;

    /// @notice Agent ID -> daily mint limit override (0 = use defaultMintLimit)
    mapping(string => uint256) public agentMintLimit;

    /// @notice Guardian address -> number of agents they currently guard
    mapping(address => uint256) public guardianAgentCount;

    // ─── Token Revenue Split ─────────────────────────────────────────────

    struct SplitInfo {
        address[] recipients;
        string[] agentIds;
        uint256[] recipientShares;
        uint256 recipientCount;
        uint256 totalShares;
        uint256 galleryFeeBpsLocked;
    }

    /// @notice tokenId -> revenue split info (locked at mint time)
    mapping(uint256 => SplitInfo) private _splits;

    /// @notice tokenId -> accumulated ETH balance for distribution
    mapping(uint256 => uint256) public tokenBalance;

    /// @notice recipient -> failed payout balance
    mapping(address => uint256) public claimable;

    // ─── Piece Lifecycle ─────────────────────────────────────────────────

    enum PieceStatus { Proposed, Approved, Minted, Rejected }

    struct Piece {
        string externalId;
        string title;
        string tokenURI;
        string[] agentIds;
        string composition;
        string method;
        PieceStatus status;
        uint256 tokenId;
        uint256 approvalsNeeded;
        uint256 approvalsReceived;
        uint256 createdAt;
    }

    uint256 private _nextTokenId;
    uint256 private _nextPieceId;

    mapping(uint256 => Piece) public pieces;

    /// @notice pieceId -> guardian address -> approved
    mapping(uint256 => mapping(address => bool)) public approvals;

    /// @notice pieceId -> unique guardian set captured at proposal time
    mapping(uint256 => address[]) private _pieceGuardians;

    /// @notice external piece ID hash -> pieceId + 1
    mapping(bytes32 => uint256) private _pieceExternalIdToIdPlusOne;

    // ─── Delegation ──────────────────────────────────────────────────────

    /// @notice Address of MetaMask DelegationManager contract (set after deploy)
    address public delegationManager;

    /// @notice Guardian -> has opted into agent delegation
    mapping(address => bool) public delegationEnabled;

    /// @notice Guardian -> rolling delegated approval timestamps
    mapping(address => MintWindow) private _delegatedApprovalWindows;

    // ─── Rolling Mint Window ─────────────────────────────────────────────

    struct MintWindow {
        uint40[32] timestamps;
        uint8 count;
    }

    /// @notice Agent ID -> rolling mint timestamps (bounded ring-like store)
    mapping(string => MintWindow) private _mintWindows;

    // ─── Events ──────────────────────────────────────────────────────────

    event AgentRegistered(string indexed agentId, address indexed guardian, address agentWallet);
    event AgentERC8004Linked(string indexed agentId, uint256 erc8004TokenId);
    event AgentWalletUpdated(string indexed agentId, address indexed newWallet);
    event GuardianUpdated(string indexed agentId, address indexed oldGuardian, address indexed newGuardian);
    event PieceProposed(uint256 indexed pieceId, string indexed externalId, string title);
    event PieceApproved(uint256 indexed pieceId, address indexed guardian);
    event PieceRejected(uint256 indexed pieceId, address indexed guardian);
    event PieceFullyApproved(uint256 indexed pieceId);
    event PieceMinted(uint256 indexed pieceId, uint256 indexed tokenId, string[] agentIds, address[] recipients);
    event RoyaltiesReceived(uint256 indexed tokenId, uint256 amount);
    event RoyaltiesDistributed(uint256 indexed tokenId, uint256 treasuryPayout, uint256 artistPayout);
    event RoyaltyPayoutDeferred(uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event RoyaltyClaimed(address indexed recipient, uint256 amount);
    event GalleryFeeUpdated(uint256 newFeeBps);
    event TreasuryUpdated(address newTreasury);
    event GalleryCustodyUpdated(address newGalleryCustody);
    event RelayerUpdated(address newRelayer);
    event DelegationManagerSet(address indexed manager);
    event DelegationToggled(address indexed guardian, bool enabled);
    event DelegatedApprovalLimitUpdated(uint256 newLimit);

    // ─── Modifiers ───────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(msg.sender == owner() || msg.sender == relayer, "Only owner or relayer");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    constructor(
        address _initialOwner,
        address _treasury,
        address _galleryCustody,
        address _relayer,
        uint256 _galleryFeeBps,
        uint256 _defaultRoyaltyBps
    ) ERC721("DeviantClaw", "DCLAW") Ownable(_initialOwner) {
        require(_initialOwner != address(0), "Owner zero address");
        require(_galleryFeeBps <= 1000, "Gallery fee max 10%");
        require(_defaultRoyaltyBps <= 2500, "Royalty max 25%");
        require(_treasury != address(0), "Treasury zero address");
        require(_galleryCustody != address(0), "Gallery custody zero address");

        treasury = _treasury;
        galleryCustody = _galleryCustody;
        relayer = _relayer;
        galleryFeeBps = _galleryFeeBps;
        defaultRoyaltyBps = _defaultRoyaltyBps;

        // Default floor prices (in wei)
        minAuctionPrice[1] = 0.01 ether; // Solo
        minAuctionPrice[2] = 0.02 ether; // Duo
        minAuctionPrice[3] = 0.04 ether; // Trio
        minAuctionPrice[4] = 0.06 ether; // Quad
    }

    // ─── Agent Registration ──────────────────────────────────────────────

    /**
     * @notice Register or update an agent with its guardian wallet and optional agent wallet.
     * @dev Agent IDs must already be canonicalized (lowercase a-z / 0-9 / hyphen).
     */
    function registerAgent(string calldata agentId, address guardian, address _agentWallet) external onlyOwner {
        _requireCanonicalAgentId(agentId);
        require(guardian != address(0), "Guardian zero address");

        address oldGuardian = agentGuardian[agentId];
        agentGuardian[agentId] = guardian;
        agentWallet[agentId] = _agentWallet;
        agentRegistered[agentId] = true;

        if (oldGuardian == address(0)) {
            guardianAgentCount[guardian] += 1;
            emit AgentRegistered(agentId, guardian, _agentWallet);
            return;
        }

        if (oldGuardian != guardian) {
            guardianAgentCount[oldGuardian] -= 1;
            guardianAgentCount[guardian] += 1;
            emit GuardianUpdated(agentId, oldGuardian, guardian);
        }
    }

    /**
     * @notice Update an agent's own wallet (address(0) clears it and falls back to guardian).
     */
    function setAgentWallet(string calldata agentId, address _agentWallet) external onlyOwner {
        _requireCanonicalAgentId(agentId);
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
     */
    function linkERC8004(string calldata agentId, uint256 erc8004Id) external onlyOwner {
        _requireCanonicalAgentId(agentId);
        require(agentRegistered[agentId], "Agent not registered");
        agentERC8004Id[agentId] = erc8004Id;
        emit AgentERC8004Linked(agentId, erc8004Id);
    }

    // ─── Piece Proposal ──────────────────────────────────────────────────

    /**
     * @notice Propose a piece with an external piece ID from the worker / D1 layer.
     */
    function proposePiece(
        string calldata externalId,
        string[] calldata agentIds,
        string calldata title,
        string calldata uri,
        string calldata composition,
        string calldata method
    ) external onlyOperator returns (uint256) {
        return _proposePiece(externalId, agentIds, title, uri, composition, method);
    }

    /**
     * @notice Legacy proposal path kept for compatibility with older scripts.
     *         New production flow should always provide an external piece ID.
     */
    function proposePiece(
        string[] calldata agentIds,
        string calldata title,
        string calldata uri,
        string calldata composition,
        string calldata method
    ) external onlyOperator returns (uint256) {
        return _proposePiece("", agentIds, title, uri, composition, method);
    }

    function _proposePiece(
        string memory externalId,
        string[] calldata agentIds,
        string calldata title,
        string calldata uri,
        string calldata composition,
        string calldata method
    ) internal returns (uint256) {
        require(agentIds.length > 0 && agentIds.length <= MAX_CONTRIBUTORS, "1-4 agents");
        require(bytes(title).length > 0, "Empty title");
        require(bytes(uri).length > 0, "Empty token URI");
        require(_equals(composition, _expectedComposition(agentIds.length)), "Composition mismatch");

        if (bytes(externalId).length > 0) {
            bytes32 externalKey = keccak256(bytes(externalId));
            require(_pieceExternalIdToIdPlusOne[externalKey] == 0, "External ID already used");
            _pieceExternalIdToIdPlusOne[externalKey] = _nextPieceId + 1;
        }

        for (uint256 i = 0; i < agentIds.length; i++) {
            _requireCanonicalAgentId(agentIds[i]);
            require(agentRegistered[agentIds[i]], "Agent not registered");
            require(agentGuardian[agentIds[i]] != address(0), "Agent has no guardian");
            for (uint256 j = i + 1; j < agentIds.length; j++) {
                require(!_equals(agentIds[i], agentIds[j]), "Duplicate agent");
            }
        }

        uint256 pieceId = _nextPieceId++;
        uint256 uniqueCount = _snapshotPieceGuardians(pieceId, agentIds);
        Piece storage p = pieces[pieceId];
        p.externalId = externalId;
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

        emit PieceProposed(pieceId, externalId, title);
        return pieceId;
    }

    // ─── Delegation (opt-in) ────────────────────────────────────────────

    /**
     * @notice Guardian approves a piece directly from their wallet.
     */
    function approvePiece(uint256 pieceId) external {
        _doApprove(pieceId, msg.sender);
    }

    /**
     * @notice Approve a piece via MetaMask delegation (opt-in).
     *         Called by the configured DelegationManager on behalf of the guardian.
     */
    function approvePieceViaDelegate(uint256 pieceId, address guardian) external {
        require(msg.sender == delegationManager, "Only DelegationManager");
        require(delegationManager != address(0), "Delegation not configured");
        require(delegationEnabled[guardian], "Guardian has not enabled delegation");
        require(_checkAndRecordDelegatedApproval(guardian), "Delegated approval limit exceeded");
        _doApprove(pieceId, guardian);
    }

    /**
     * @notice Guardian opts in/out of agent delegation.
     */
    function toggleDelegation(bool enabled) external {
        require(guardianAgentCount[msg.sender] > 0, "Not a registered guardian");
        delegationEnabled[msg.sender] = enabled;
        emit DelegationToggled(msg.sender, enabled);
    }

    /**
     * @notice Guardian rejects a piece before mint.
     */
    function rejectPiece(uint256 pieceId) external {
        Piece storage p = pieces[pieceId];
        require(p.status == PieceStatus.Proposed || p.status == PieceStatus.Approved, "Cannot reject");
        require(_isGuardianOfPiece(pieceId, msg.sender), "Not guardian");

        p.status = PieceStatus.Rejected;
        emit PieceRejected(pieceId, msg.sender);
    }

    // ─── Minting ─────────────────────────────────────────────────────────

    /**
     * @notice Mint an approved piece to the fixed gallery custody address.
     */
    function mintPiece(uint256 pieceId) external nonReentrant onlyOperator returns (uint256) {
        return _mintApprovedPiece(pieceId);
    }

    /**
     * @notice Backward-compatible mint entrypoint. Recipient must equal gallery custody.
     */
    function mintPiece(uint256 pieceId, address to) external nonReentrant onlyOperator returns (uint256) {
        require(to == galleryCustody, "Recipient must be gallery custody");
        return _mintApprovedPiece(pieceId);
    }

    function _mintApprovedPiece(uint256 pieceId) internal returns (uint256) {
        Piece storage p = pieces[pieceId];
        require(p.status == PieceStatus.Approved, "Not approved");

        for (uint256 i = 0; i < p.agentIds.length; i++) {
            require(_checkAndRecordMint(p.agentIds[i]), "Agent rate limit exceeded");
        }

        uint256 tokenId = _nextTokenId++;
        _safeMint(galleryCustody, tokenId);
        _setTokenURI(tokenId, p.tokenURI);

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
     */
    function royaltyInfo(uint256 /* tokenId */, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        royaltyAmount = (salePrice * defaultRoyaltyBps) / 10000;
        receiver = address(this);
    }

    /**
     * @notice Receive ETH tagged to a specific token (e.g. royalty/sale settlement).
     */
    function depositForToken(uint256 tokenId) external payable {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        tokenBalance[tokenId] += msg.value;
        emit RoyaltiesReceived(tokenId, msg.value);
    }

    /**
     * @notice Distribute accumulated balance for a token using push-first / pull-fallback.
     */
    function distributeRoyalties(uint256 tokenId) external nonReentrant {
        uint256 balance = tokenBalance[tokenId];
        require(balance > 0, "No balance");

        SplitInfo storage split = _splits[tokenId];
        require(split.recipientCount > 0, "No split info");

        uint256 galleryShare = (balance * split.galleryFeeBpsLocked) / 10000;
        uint256 artistPool = balance - galleryShare;
        uint256[] memory payouts = new uint256[](split.recipientCount);
        uint256 distributed = 0;

        tokenBalance[tokenId] = 0;

        for (uint256 i = 0; i < split.recipientCount; i++) {
            uint256 payout = (artistPool * split.recipientShares[i]) / split.totalShares;
            payouts[i] = payout;
            distributed += payout;
        }

        uint256 dust = artistPool - distributed;
        uint256 treasuryPayout = galleryShare + dust;

        _attemptPayout(tokenId, treasury, treasuryPayout);

        for (uint256 i = 0; i < split.recipientCount; i++) {
            _attemptPayout(tokenId, split.recipients[i], payouts[i]);
        }

        emit RoyaltiesDistributed(tokenId, treasuryPayout, distributed);
    }

    /**
     * @notice Claim deferred royalty payouts.
     */
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing claimable");
        claimable[msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Claim transfer failed");
        emit RoyaltyClaimed(msg.sender, amount);
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

    function setGalleryCustody(address _galleryCustody) external onlyOwner {
        require(_galleryCustody != address(0), "Zero address");
        galleryCustody = _galleryCustody;
        emit GalleryCustodyUpdated(_galleryCustody);
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function setDefaultRoyalty(uint256 _bps) external onlyOwner {
        require(_bps <= 2500, "Max 25%");
        defaultRoyaltyBps = _bps;
    }

    /**
     * @notice Set daily mint limit for a specific agent (0 = use default).
     */
    function setAgentMintLimit(string calldata agentId, uint256 limit) external onlyOwner {
        _requireCanonicalAgentId(agentId);
        require(limit <= MAX_TRACKED_MINTS, "Limit too high");
        agentMintLimit[agentId] = limit;
    }

    /**
     * @notice Update the default daily mint limit for all agents.
     */
    function setDefaultMintLimit(uint256 limit) external onlyOwner {
        require(limit > 0, "Limit must be > 0");
        require(limit <= MAX_TRACKED_MINTS, "Limit too high");
        defaultMintLimit = limit;
    }

    function setDelegatedApprovalLimit(uint256 limit) external onlyOwner {
        require(limit > 0, "Limit must be > 0");
        require(limit <= MAX_TRACKED_MINTS, "Limit too high");
        delegatedApprovalLimit = limit;
        emit DelegatedApprovalLimitUpdated(limit);
    }

    function setDelegationManager(address _manager) external onlyOwner {
        delegationManager = _manager;
        emit DelegationManagerSet(_manager);
    }

    /**
     * @notice Set minimum auction price floor for a composition size.
     */
    function setMinAuctionPrice(uint256 compositionSize, uint256 minPriceWei) external onlyOwner {
        require(compositionSize >= 1 && compositionSize <= 4, "Invalid composition size");
        minAuctionPrice[compositionSize] = minPriceWei;
    }

    /**
     * @notice Emit a metadata refresh signal for marketplace/indexer consumers.
     *         Useful when off-chain metadata at the existing tokenURI has changed.
     */
    function refreshMetadata(uint256 tokenId) external onlyOperator {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        emit MetadataUpdate(tokenId);
    }

    function refreshMetadataBatch(uint256 fromTokenId, uint256 toTokenId) external onlyOperator {
        require(fromTokenId <= toTokenId, "Invalid range");
        require(_ownerOf(fromTokenId) != address(0), "Start token missing");
        require(_ownerOf(toTokenId) != address(0), "End token missing");
        emit BatchMetadataUpdate(fromTokenId, toTokenId);
    }

    /**
     * @notice Check if a proposed auction price meets the floor for a token.
     */
    function validateAuctionPrice(uint256 tokenId, uint256 priceWei) external view returns (bool valid, uint256 floorWei) {
        SplitInfo storage split = _splits[tokenId];
        uint256 compositionSize = split.agentIds.length;
        if (compositionSize == 0) compositionSize = 1;
        floorWei = minAuctionPrice[compositionSize];
        valid = priceWei >= floorWei;
    }

    // ─── View Helpers ────────────────────────────────────────────────────

    function getTokenSplit(uint256 tokenId)
        external
        view
        returns (address[] memory recipients, string[] memory agentIds, uint256 recipientCount)
    {
        SplitInfo storage s = _splits[tokenId];
        return (s.recipients, s.agentIds, s.recipientCount);
    }

    function getTokenSplitShares(uint256 tokenId)
        external
        view
        returns (address[] memory recipients, string[] memory agentIds, uint256[] memory recipientShares, uint256 totalShares)
    {
        SplitInfo storage s = _splits[tokenId];
        return (s.recipients, s.agentIds, s.recipientShares, s.totalShares);
    }

    function getTokenGalleryFeeBps(uint256 tokenId) external view returns (uint256) {
        return _splits[tokenId].galleryFeeBpsLocked;
    }

    function getPieceAgents(uint256 pieceId) external view returns (string[] memory) {
        return pieces[pieceId].agentIds;
    }

    function getPieceGuardians(uint256 pieceId) external view returns (address[] memory) {
        return _pieceGuardians[pieceId];
    }

    function getPieceStatus(uint256 pieceId) external view returns (PieceStatus) {
        return pieces[pieceId].status;
    }

    function getPieceExternalId(uint256 pieceId) external view returns (string memory) {
        return pieces[pieceId].externalId;
    }

    function getPieceIdByExternalId(string calldata externalId) external view returns (uint256) {
        uint256 plusOne = _pieceExternalIdToIdPlusOne[keccak256(bytes(externalId))];
        require(plusOne != 0, "Unknown external ID");
        return plusOne - 1;
    }

    function getPieceMetadata(uint256 pieceId)
        external
        view
        returns (
            string memory title,
            string memory composition,
            string memory method,
            string[] memory agentIds,
            PieceStatus status,
            uint256 createdAt
        )
    {
        Piece storage p = pieces[pieceId];
        return (p.title, p.composition, p.method, p.agentIds, p.status, p.createdAt);
    }

    function totalPieces() external view returns (uint256) {
        return _nextPieceId;
    }

    function isRegisteredGuardian(address guardian) external view returns (bool) {
        return guardianAgentCount[guardian] > 0;
    }

    function getAgentMintCount(string calldata agentId) external view returns (uint256) {
        MintWindow storage window = _mintWindows[agentId];
        return _activeWindowCount(window);
    }

    function getGuardianDelegatedApprovalCount(address guardian) external view returns (uint256) {
        MintWindow storage window = _delegatedApprovalWindows[guardian];
        return _activeWindowCount(window);
    }

    // ─── Internal ────────────────────────────────────────────────────────

    function _lockSplit(uint256 tokenId, string[] storage agentIds) internal {
        SplitInfo storage split = _splits[tokenId];
        split.galleryFeeBpsLocked = galleryFeeBps;

        for (uint256 i = 0; i < agentIds.length; i++) {
            split.agentIds.push(agentIds[i]);
        }

        address[] memory tempRecipients = new address[](agentIds.length);
        uint256[] memory tempShares = new uint256[](agentIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < agentIds.length; i++) {
            address recipient = agentWallet[agentIds[i]];
            if (recipient == address(0)) {
                recipient = agentGuardian[agentIds[i]];
            }

            bool found = false;
            for (uint256 j = 0; j < count; j++) {
                if (tempRecipients[j] == recipient) {
                    found = true;
                    tempShares[j] += 1;
                    break;
                }
            }
            if (!found) {
                tempRecipients[count] = recipient;
                tempShares[count] = 1;
                count++;
            }
        }

        for (uint256 i = 0; i < count; i++) {
            split.recipients.push(tempRecipients[i]);
            split.recipientShares.push(tempShares[i]);
        }
        split.recipientCount = count;
        split.totalShares = agentIds.length;
    }

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

    function _isGuardianOfPiece(uint256 pieceId, address account) internal view returns (bool) {
        address[] storage guardians = _pieceGuardians[pieceId];
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == account) return true;
        }
        return false;
    }

    function _snapshotPieceGuardians(uint256 pieceId, string[] calldata agentIds) internal returns (uint256) {
        address[] storage guardians = _pieceGuardians[pieceId];
        for (uint256 i = 0; i < agentIds.length; i++) {
            address g = agentGuardian[agentIds[i]];
            bool found = false;
            for (uint256 j = 0; j < guardians.length; j++) {
                if (guardians[j] == g) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                guardians.push(g);
            }
        }
        return guardians.length;
    }

    function _checkAndRecordMint(string storage agentId) internal returns (bool) {
        MintWindow storage window = _mintWindows[agentId];
        uint256 limit = agentMintLimit[agentId];
        if (limit == 0) limit = defaultMintLimit;
        return _checkAndRecordWindow(window, limit);
    }

    function _checkAndRecordDelegatedApproval(address guardian) internal returns (bool) {
        MintWindow storage window = _delegatedApprovalWindows[guardian];
        return _checkAndRecordWindow(window, delegatedApprovalLimit);
    }

    function _activeWindowCount(MintWindow storage window) internal view returns (uint256 active) {
        uint256 cutoff = block.timestamp - MINT_WINDOW;
        for (uint256 i = 0; i < window.count; i++) {
            if (window.timestamps[i] > cutoff) active++;
        }
    }

    function _checkAndRecordWindow(MintWindow storage window, uint256 limit) internal returns (bool) {
        uint256 cutoff = block.timestamp - MINT_WINDOW;
        uint256 active = 0;
        uint256 firstExpired = type(uint256).max;
        for (uint256 i = 0; i < window.count; i++) {
            if (window.timestamps[i] > cutoff) {
                active++;
            } else if (firstExpired == type(uint256).max) {
                firstExpired = i;
            }
        }

        if (active >= limit) return false;

        uint40 nowTs = uint40(block.timestamp);
        if (window.count < MAX_TRACKED_MINTS) {
            window.timestamps[window.count] = nowTs;
            window.count += 1;
            return true;
        }

        if (firstExpired != type(uint256).max) {
            window.timestamps[firstExpired] = nowTs;
            return true;
        }

        return false;
    }

    function _attemptPayout(uint256 tokenId, address recipient, uint256 amount) internal {
        if (amount == 0) return;

        (bool sent, ) = payable(recipient).call{value: amount}("");
        if (!sent) {
            claimable[recipient] += amount;
            emit RoyaltyPayoutDeferred(tokenId, recipient, amount);
        }
    }

    function _expectedComposition(uint256 contributorCount) internal pure returns (string memory) {
        if (contributorCount == 1) return "solo";
        if (contributorCount == 2) return "duo";
        if (contributorCount == 3) return "trio";
        if (contributorCount == 4) return "quad";
        revert("Invalid contributor count");
    }

    function _equals(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _requireCanonicalAgentId(string memory agentId) internal pure {
        bytes memory raw = bytes(agentId);
        require(raw.length > 0, "Empty agent ID");
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 char = raw[i];
            bool isDigit = char >= 0x30 && char <= 0x39;
            bool isLower = char >= 0x61 && char <= 0x7A;
            bool isHyphen = char == 0x2D;
            require(isDigit || isLower || isHyphen, "Agent ID must be lowercase a-z, 0-9, or -");
        }
    }

    // ─── Receive ETH ─────────────────────────────────────────────────────

    receive() external payable {}

    // ─── Required Overrides ──────────────────────────────────────────────

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC721Enumerable, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
}
