// Example models, ordered from simple to more involved. Each says what to listen for.

export interface Example {
  id: string
  title: string
  description: string
  code: string
  data: Record<string, unknown>
}

const threeModesCode = `// A mixture of K Gaussian "blobs" in D dimensions: a posterior with K separate modes.
// The modes differ in location, width and weight. Here they sit at the corners of a
// triangle in a plane tilted through all five coordinates, so no single coordinate
// separates them.
data {
  int<lower=1> K;
  int<lower=1> D;
  array[K] vector[D] center;
  vector<lower=0>[K] scale;
  simplex[K] weight;
}
parameters {
  vector[D] x;
}
model {
  vector[K] lp;
  for (k in 1:K)
    lp[k] = log(weight[k]) + normal_lpdf(x | center[k], scale[k]);
  target += log_sum_exp(lp);
}
`

export const EXAMPLES: Example[] = [
  {
    id: 'normal',
    title: 'Independent normals',
    description: 'Five independent standard normals: the reference for good mixing.',
    code: `parameters {
  vector[5] x;
}
model {
  x ~ std_normal();
}
`,
    data: {},
  },
  {
    id: 'correlated',
    title: 'Strongly correlated pair',
    description: 'b tracks a closely (correlation ≈ 0.995): the pair moves together and wanders slowly.',
    code: `parameters {
  real a;
  real b;
  vector[3] z;
}
model {
  a ~ normal(0, 1);
  b ~ normal(a, 0.1);  // b stays within about 0.1 of a
  z ~ std_normal();
}
`,
    data: {},
  },
  {
    id: 'eightSchools',
    title: 'Eight schools (non-centered)',
    description: 'Hierarchical model, non-centered: one mode, all chains alike.',
    code: `data {
  int<lower=0> J;
  array[J] real y;
  array[J] real<lower=0> sigma;
}
parameters {
  real mu;
  real<lower=0> tau;
  vector[J] theta_raw;
}
transformed parameters {
  vector[J] theta = mu + tau * theta_raw;
}
model {
  mu ~ normal(0, 5);
  tau ~ cauchy(0, 5);
  theta_raw ~ std_normal();
  y ~ normal(theta, sigma);
}
`,
    data: { J: 8, y: [28, 8, -3, 7, -1, 1, 18, 12], sigma: [15, 10, 16, 11, 9, 11, 10, 18] },
  },
  {
    id: 'eightSchoolsCentered',
    title: 'Eight schools (centered: a funnel)',
    description: 'Same model, centered: a funnel in which tau gets stuck low.',
    code: `data {
  int<lower=0> J;
  array[J] real y;
  array[J] real<lower=0> sigma;
}
parameters {
  real mu;
  real<lower=0> tau;
  vector[J] theta;
}
model {
  mu ~ normal(0, 5);
  tau ~ cauchy(0, 5);
  theta ~ normal(mu, tau);
  y ~ normal(theta, sigma);
}
`,
    data: { J: 8, y: [28, 8, -3, 7, -1, 1, 18, 12], sigma: [15, 10, 16, 11, 9, 11, 10, 18] },
  },
  {
    id: 'threeModes',
    title: 'Three modes, mixing well',
    description: 'Three modes; chains hop between them often.',
    code: threeModesCode,
    data: {
      K: 3, D: 5,
      center: [[-1.669, -1.677, 0.813, 0.857, 1.159], [0.957, 1.607, -1.854, 0.946, 0.709], [0.711, 0.07, 1.041, -1.803, -1.867]],
      scale: [1.0, 0.7, 1.3], weight: [0.5, 0.3, 0.2],
    },
  },
  {
    id: 'threeModesSlow',
    title: 'Three modes, mixing slowly',
    description: 'Same modes, farther apart: chains linger and hop rarely.',
    code: threeModesCode,
    data: {
      K: 3, D: 5,
      center: [[-2.169, -2.18, 1.056, 1.114, 1.506], [1.244, 2.089, -2.41, 1.23, 0.922], [0.925, 0.09, 1.354, -2.344, -2.428]],
      scale: [1.0, 0.7, 1.3], weight: [0.5, 0.3, 0.2],
    },
  },
  {
    id: 'slowStart',
    title: 'Slow start: a winding valley',
    description: 'Chains crawl along a winding valley for hundreds of draws before reaching the bulk.',
    code: `// A long, narrow valley that winds back and forth before reaching the bulk.
// x1 runs along the valley, x2 across it; z are independent normals for contrast.
data {
  real c;           // center of the bulk along x1
  real<lower=0> g;  // gentle slope pulling x1 toward c (small = slow crawl)
  real A;           // amplitude of the valley's wiggle
  real k;           // wiggle frequency: valley follows x2 = A * sin(k * x1)
  real<lower=0> w;  // valley width
  real straight;    // the valley is straight for x1 > c - straight
}
parameters {
  real x1;
  real x2;
  vector[3] z;
}
model {
  // Smoothed |x1 - c|: constant pull g far away, bulk of width ~1/g around c.
  target += -g * sqrt(square(x1 - c) + 1);
  // Narrow valley along x2 = A sin(k x1), fading to a straight valley near the bulk.
  x2 ~ normal(A * sin(k * x1) * inv_logit(c - straight - x1), w);
  z ~ std_normal();
}
`,
    data: { c: 60, g: 0.7, A: 3, k: 1.5, w: 0.05, straight: 8 },
  },
]

// JSON with each array kept on one line.
export function formatData(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2).replace(/\[\s+([^\]]*?)\s+\]/g, (_, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`)
}
