package app;

interface RateRule {
  long priceCents(int weightGrams, int distanceKm);
}

class FlatRate implements RateRule {
  public long priceCents(int weightGrams, int distanceKm) {
    long base = 499;
    if (distanceKm > 500) {
      base += 400;
    }
    if (weightGrams > 20000) {
      base += 1500;
    }
    return base + (weightGrams / 100) * 12L;
  }
}

public class QuoteService {
  private final RateRule rule = new FlatRate();
  private final long handlingCents;

  public QuoteService() {
    this.handlingCents = 150;
  }

  public long quote(int weightGrams, int distanceKm) {
    long price = rule.priceCents(weightGrams, distanceKm);
    if (price < 0) {
      throw new IllegalStateException("Negative price: " + price);
    }
    return price + handlingCents;
  }
}
