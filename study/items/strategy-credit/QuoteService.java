package app;

import java.util.Map;
import java.util.Properties;

interface RateRule {
  long priceCents(int weightGrams, int distanceKm);
}

class FlatRate implements RateRule {
  public long priceCents(int weightGrams, int distanceKm) {
    return 499;
  }
}

class WeightRate implements RateRule {
  public long priceCents(int weightGrams, int distanceKm) {
    return 199 + (weightGrams / 100) * 12L;
  }
}

class ZoneRate implements RateRule {
  public long priceCents(int weightGrams, int distanceKm) {
    return distanceKm > 500 ? 899 : 549;
  }
}

public class QuoteService {
  private final Map<String, RateRule> rules;
  private final String activeRule;

  public QuoteService(Map<String, RateRule> rules, Properties settings) {
    this.rules = Map.copyOf(rules);
    this.activeRule = settings.getProperty("shipping.rule", "flat");
  }

  public long quote(int weightGrams, int distanceKm) {
    RateRule rule = rules.get(activeRule);
    if (rule == null) {
      throw new IllegalStateException("Unknown rule: " + activeRule);
    }
    return rule.priceCents(weightGrams, distanceKm);
  }
}
