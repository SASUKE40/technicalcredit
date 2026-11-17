package app;

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

public class StockLevels {
  private final StockListener listener = new ReorderDesk();
  private int level;

  public int level() {
    return level;
  }

  public boolean isLow() {
    return level < 5;
  }

  public void adjust(String sku, int delta) {
    level += delta;
    listener.levelChanged(sku, level);
  }
}
