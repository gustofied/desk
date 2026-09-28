# Pearl and GPU rental demand

Evidence behind the [GPU rental price study](https://www.adamsioud.com/exemplars/gpu-prices/).

## What the price study establishes

Sellers raised their quoted prices broadly within the recorded RTX 3090 sample.
On May 30, 39 of 40 eligible sellers were more than 10% above their April
references; 34 remained above a 100% threshold. Those figures describe repricing.
They do not identify the renters or explain why sellers changed their prices.

## Evidence for mining demand

[Tom's Hardware, May 31](https://www.tomshardware.com/tech-industry/cryptomining/new-ai-compute-cryptocurrency-pearl-sparks-a-gpu-mining-rush-but-profitability-is-sliding)
reported Pearl mining on rented RTX 4090 and 5090 instances on Vast.ai and RunPod.
A [June experimental study](https://arxiv.org/html/2606.04819v1#S4.SS5)
also describes earning PRL using rented RTX 3090s. This supports the mechanism:
mining can bring buyers into GPU rental markets when expected token revenue
covers the rental cost and fees. Token price, rewards, competing network work
and hardware performance all affect that calculation.

The paper's token-price references include a different asset named Perle. Its
reported profitability and GPU-equivalent estimates are therefore not used to
quantify demand here. Rental experiments do not establish Pearl's contribution
to the wider price movement.

## Reading the network data

- [2Miners network history](https://2miners.com/prl-network-hashrate) reports an
  estimated network hashrate, derived from difficulty and block timing.
- [2Miners pool statistics](https://2miners.com/prl-mining-pool) describe that pool;
  pool activity should not be confused with the whole network.
- [PRLScan pools](https://prlscan.com/pools) and the
  [Pearl compute dashboard](https://compute.pearlresearch.ai/dashboard) provide
  additional network context. Their current views do not establish historical
  Vast.ai bookings.

Hashrate measures mining work recognised by the protocol. It is not a count of
GPUs, rented machines or rental starts. Software improvements and changes to
the proof rules can alter it without a proportional change in physical capacity.

## The later breach reports

The [community account](https://x.com/zkCryptic/status/2080257789167882285)
raises allegations about artificially inflated hashrate. The linked
[dense-only consensus commit](https://github.com/pearl-research-labs/pearl/commit/670da8c0d989e4c93e120e3aa37ff54446ec55ab)
is dated July 23, 2026 and rejects MoE certificates after activation. The code
change does not verify the alleged exploit multiplier, wallet ownership or pool
involvement. Its July timing cannot by itself explain the May price rise or the
earlier June decline.

## Interpretation

Pearl mining may have contributed to rental demand during the price rise.
The available evidence does not establish how much of the increase it caused.
The stronger result is the breadth of seller repricing in the sample.

Offers that disappear and later return can be studied as inferred rentals,
using the last quote as an estimated entry rate. That remains an assumption:
withdrawals and changes in the capped search results can produce the same
pattern. This is a separate demand investigation, not a completed transaction
series or evidence that a particular rental was used for mining.
