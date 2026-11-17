package app;

import java.util.ArrayList;
import java.util.List;

interface StockListener {
  void levelChanged(String sku, int level);
}

class ReorderDesk implements StockListener {
  public void levelChanged(String sku, int level) {
    if (level < 5) {
      System.out.println("reorder " + sku);
    }
  }
}

class ShelfDisplay implements StockListener {
  public void levelChanged(String sku, int level) {
    System.out.println(sku + ": " + level);
  }
}

public class StockLevels {
  private final List<StockListener> listeners = new ArrayList<>();
  private int level;

  public void subscribe(StockListener listener) {
    listeners.add(listener);
  }

  public void unsubscribe(StockListener listener) {
    listeners.remove(listener);
  }

  public void adjust(String sku, int delta) {
    level += delta;
    for (StockListener listener : listeners) {
      listener.levelChanged(sku, level);
    }
  }
}
