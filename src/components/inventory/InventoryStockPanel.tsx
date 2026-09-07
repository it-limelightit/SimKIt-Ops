import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  EmptyState,
} from "@/components/ui-kit";
import {
  Boxes,
  AlertCircle,
  Plus,
  RefreshCw,
  Search,
  IndianRupee,
  Edit2,
  Trash2,
  TrendingDown,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  InventoryStockItem,
  PREDEFINED_CATEGORIES,
  PROXY_MODELS,
  VIBRATION_MODELS,
} from "@/lib/inventory-service";

const CUSTOM_OPTION_VALUE = "__custom__";

export function InventoryStockPanel() {
  const [stock, setStock] = useState<InventoryStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [category, setCategory] = useState(PREDEFINED_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [sensorType, setSensorType] = useState("");
  const [customSensorType, setCustomSensorType] = useState("");
  const [actualQuantity, setActualQuantity] = useState<number | "">("");
  const [minQuantity, setMinQuantity] = useState<number | "">("");
  const [unitPrice, setUnitPrice] = useState<number | "">("");
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_stock" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setStock((data ?? []) as unknown as InventoryStockItem[]);
    } catch (e: any) {
      console.error("Error fetching inventory stock:", e);
      toast.error("Failed to load inventory stock data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStock();
    const channel = supabase
      .channel("inventory-stock-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_stock" },
        () => void fetchStock()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchStock]);

  const resetForm = () => {
    setEditingId(null);
    setCategory(PREDEFINED_CATEGORIES[0]);
    setCustomCategory("");
    setSensorType("");
    setCustomSensorType("");
    setActualQuantity("");
    setMinQuantity("");
    setUnitPrice("");
    setEntryDate(new Date().toISOString().split("T")[0]);
    setNotes("");
  };

  const handleOpenAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleEditItem = (item: InventoryStockItem) => {
    setEditingId(item.id);
    
    if (PREDEFINED_CATEGORIES.includes(item.category)) {
      setCategory(item.category);
      setCustomCategory("");
    } else {
      setCategory(CUSTOM_OPTION_VALUE);
      setCustomCategory(item.category);
    }

    if (item.sensor_type) {
      const isProxy = item.category.startsWith("Proxy");
      const isVib = item.category === "Vibration Sensor";
      const modelList = isProxy ? PROXY_MODELS : isVib ? VIBRATION_MODELS : [];

      if (modelList.includes(item.sensor_type)) {
        setSensorType(item.sensor_type);
        setCustomSensorType("");
      } else {
        setSensorType(CUSTOM_OPTION_VALUE);
        setCustomSensorType(item.sensor_type);
      }
    } else {
      setSensorType("");
      setCustomSensorType("");
    }

    setActualQuantity(item.actual_quantity);
    setMinQuantity(item.min_quantity);
    setUnitPrice(item.unit_price);
    setEntryDate(item.entry_date || new Date().toISOString().split("T")[0]);
    setNotes(item.notes || "");
    setIsModalOpen(true);
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}" from stock?`)) return;
    try {
      const { error } = await supabase
        .from("inventory_stock" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success(`Deleted ${name} from stock`);
      void fetchStock();
    } catch (e: any) {
      toast.error("Failed to delete stock item: " + e.message);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === CUSTOM_OPTION_VALUE ? customCategory.trim() : category;
    
    let finalSensorType: string | null = null;
    if (category.startsWith("Proxy") || category === "Vibration Sensor") {
      finalSensorType = sensorType === CUSTOM_OPTION_VALUE ? customSensorType.trim() : sensorType;
    }

    if (!finalCategory) {
      toast.error("Please specify a valid item category");
      return;
    }
    if (actualQuantity === "" || actualQuantity < 0) {
      toast.error("Please enter a valid actual quantity");
      return;
    }
    if (minQuantity === "" || minQuantity < 0) {
      toast.error("Please enter a valid minimum quantity limit");
      return;
    }
    if (unitPrice === "" || unitPrice < 0) {
      toast.error("Please enter a valid unit price");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        category: finalCategory,
        sensor_type: finalSensorType,
        actual_quantity: Number(actualQuantity),
        min_quantity: Number(minQuantity),
        unit_price: Number(unitPrice),
        entry_date: entryDate,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error } = await supabase
          .from("inventory_stock" as any)
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Stock item updated successfully");
      } else {
        const { error } = await supabase
          .from("inventory_stock" as any)
          .insert(payload);
        if (error) throw error;
        toast.success("New stock item added successfully");
      }

      setIsModalOpen(false);
      resetForm();
      void fetchStock();
    } catch (e: any) {
      console.error("Save stock error:", e);
      toast.error("Failed to save stock item: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Live Calculations (KTA Analytics)
  const computedStock = useMemo(() => {
    return stock.map((s) => ({
      ...s,
      total_price: Number(s.actual_quantity) * Number(s.unit_price),
    }));
  }, [stock]);

  const [statusFilter, setStatusFilter] = useState<"all" | "low" | "out">("all");

  const filteredStock = useMemo(() => {
    return computedStock.filter((item) => {
      const matchesSearch =
        item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.sensor_type && item.sensor_type.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCat = categoryFilter === "all" || item.category === categoryFilter;

      let matchesStatus = true;
      if (statusFilter === "low") {
        matchesStatus = item.actual_quantity <= item.min_quantity && item.actual_quantity > 0;
      } else if (statusFilter === "out") {
        matchesStatus = item.actual_quantity === 0;
      }

      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [computedStock, searchQuery, categoryFilter, statusFilter]);

  const ktaMetrics = useMemo(() => {
    let totalItems = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    // Filter items based on category and search query for accurate KTA totals
    const scopedForKta = computedStock.filter((item) => {
      const matchesSearch =
        item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.sensor_type && item.sensor_type.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCat = categoryFilter === "all" || item.category === categoryFilter;
      return matchesSearch && matchesCat;
    });

    scopedForKta.forEach((item) => {
      totalItems += item.actual_quantity;
      totalValuation += item.total_price;
      if (item.actual_quantity === 0) {
        outOfStockCount++;
      } else if (item.actual_quantity <= item.min_quantity) {
        lowStockCount++;
      }
    });

    return { totalItems, totalValuation, lowStockCount, outOfStockCount };
  }, [computedStock, searchQuery, categoryFilter]);


  const autoCalculatedPrice = useMemo(() => {
    const qty = Number(actualQuantity) || 0;
    const price = Number(unitPrice) || 0;
    return qty * price;
  }, [actualQuantity, unitPrice]);

  return (
    <div className="space-y-6">
      {/* Header & Primary KTA Analytics Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          onClick={() => setStatusFilter("all")}
          className={`p-4 border cursor-pointer transition-all ${
            statusFilter === "all"
              ? "border-violet bg-violet/10 ring-1 ring-violet shadow-md"
              : "border-border/70 bg-surface-raised/30 hover:border-violet/50"
          } flex items-center justify-between`}
        >
          <div className="space-y-1">
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">
              Total Stock Items
            </p>
            <p className="text-2xl font-extrabold text-text-primary">
              {ktaMetrics.totalItems} <span className="text-xs font-normal text-text-muted">units</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-violet/10 flex items-center justify-center text-violet">
            <Boxes size={20} />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter("all")}
          className="p-4 border border-border/70 bg-surface-raised/30 flex items-center justify-between cursor-pointer hover:border-emerald-500/50 transition-all"
        >
          <div className="space-y-1">
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">
              Total Valuation
            </p>
            <p className="text-2xl font-extrabold text-emerald-400 flex items-center">
              ₹{ktaMetrics.totalValuation.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <IndianRupee size={20} />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "low" ? "all" : "low")}
          className={`p-4 border cursor-pointer transition-all ${
            statusFilter === "low"
              ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400 shadow-md"
              : "border-border/70 bg-surface-raised/30 hover:border-amber-400/50"
          } flex items-center justify-between`}
        >
          <div className="space-y-1">
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">
              Low Stock Warnings
            </p>
            <p className="text-2xl font-extrabold text-amber-400">
              {ktaMetrics.lowStockCount} <span className="text-xs font-normal text-text-muted">items</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
            <TrendingDown size={20} />
          </div>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "out" ? "all" : "out")}
          className={`p-4 border cursor-pointer transition-all ${
            statusFilter === "out"
              ? "border-rose-400 bg-rose-500/10 ring-1 ring-rose-400 shadow-md"
              : "border-border/70 bg-surface-raised/30 hover:border-rose-400/50"
          } flex items-center justify-between`}
        >
          <div className="space-y-1">
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">
              Out of Stock
            </p>
            <p className="text-2xl font-extrabold text-rose-400">
              {ktaMetrics.outOfStockCount} <span className="text-xs font-normal text-text-muted">items</span>
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400">
            <AlertCircle size={20} />
          </div>
        </Card>
      </div>


      {/* Control Bar: Filters & Add Stock Action */}
      <Card className="p-4 border border-border/80 bg-surface flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto flex-1">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search categories or models..."
              className="pl-9 bg-surface-raised/40 text-xs h-9"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <SlidersHorizontal size={14} className="text-text-muted hidden sm:inline" />
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-surface-raised/40 text-xs h-9 w-full sm:w-48"
            >
              <option value="all">All Categories</option>
              {PREDEFINED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          <Button
            onClick={fetchStock}
            variant="outline"
            className="h-9 px-3 text-xs flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>

          <Button
            onClick={handleOpenAddModal}
            className="h-9 px-4 text-xs bg-violet hover:bg-violet-dark text-white font-semibold flex items-center gap-1.5 cursor-pointer rounded-lg shadow-md transition-all"
          >
            <Plus size={16} />
            Add Inventory Item
          </Button>
        </div>
      </Card>

      {/* Tabular Stock Breakdown Table */}
      <Card className="border border-border/80 bg-surface overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted text-xs flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-violet" />
            Loading live inventory stock database...
          </div>
        ) : filteredStock.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No inventory items found"
            description="Start by adding new stock items or adjust your search filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-surface-raised/40 text-text-secondary uppercase tracking-wider font-semibold text-[11px]">
                  <th className="p-3.5 pl-4">Entry Date</th>
                  <th className="p-3.5">Category & Model</th>
                  <th className="p-3.5 text-center">In Stock</th>
                  <th className="p-3.5 text-center">Min Threshold</th>
                  <th className="p-3.5 text-right">Unit Price</th>
                  <th className="p-3.5 text-right">Total Price</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-center pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-text-primary font-sans">
                {filteredStock.map((item) => {
                  const isLow = item.actual_quantity <= item.min_quantity && item.actual_quantity > 0;
                  const isOut = item.actual_quantity === 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isOut
                          ? "bg-rose-500/10 hover:bg-rose-500/15"
                          : isLow
                          ? "bg-amber-500/10 hover:bg-amber-500/15"
                          : "hover:bg-surface-raised/20"
                      }`}
                    >
                      <td className="p-3.5 pl-4 whitespace-nowrap text-text-secondary font-mono">
                        {item.entry_date ? new Date(item.entry_date).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        }) : "—"}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-bold text-text-primary">
                            {item.category}
                          </span>
                          {item.sensor_type && (
                            <span className="text-[10px] text-violet font-mono">
                              Model: {item.sensor_type}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`p-3.5 text-center font-extrabold text-sm whitespace-nowrap ${
                        isOut ? "text-rose-400 font-black" : isLow ? "text-amber-400 font-black" : ""
                      }`}>
                        {item.actual_quantity}
                      </td>
                      <td className="p-3.5 text-center text-text-muted font-medium whitespace-nowrap">
                        {item.min_quantity}
                      </td>
                      <td className="p-3.5 text-right font-mono font-medium whitespace-nowrap">
                        ₹{Number(item.unit_price).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-mono font-extrabold text-emerald-400 whitespace-nowrap">
                        ₹{item.total_price.toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        {isOut ? (
                          <Badge className="bg-rose-600/30 text-rose-300 border border-rose-500/60 font-bold text-[10.5px] px-2.5 py-0.5 shadow-sm">
                            🚨 Out of Stock
                          </Badge>
                        ) : isLow ? (
                          <Badge className="bg-amber-500/30 text-amber-300 border border-amber-400/60 font-bold text-[10.5px] px-2.5 py-0.5 shadow-sm">
                            ⚠️ Low Stock Alert
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px]">
                            In Stock
                          </Badge>
                        )}
                      </td>

                      <td className="p-3.5 text-center pr-4 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleEditItem(item)}
                            title="Edit Stock Entry"
                            className="p-1.5 text-text-secondary hover:text-violet hover:bg-violet/10 rounded transition-colors"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item.id, item.category)}
                            title="Delete Stock Entry"
                            className="p-1.5 text-text-secondary hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add / Edit Inventory Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-xl border border-border/80 bg-surface shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-border/70 bg-surface-raised/40 flex items-center justify-between">
              <h3 className="text-md font-bold text-text-primary flex items-center gap-2">
                <Boxes size={18} className="text-violet" />
                {editingId ? "Edit Stock Item" : "Add New Stock Item"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors text-sm font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Entry Date */}
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Stock Entry Date <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>

                {/* Category Dropdown */}
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Item Category <span className="text-rose-400">*</span>
                  </Label>
                  <Select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setSensorType("");
                    }}
                    className="bg-surface-raised/50 h-9"
                  >
                    {PREDEFINED_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>+ Add Custom Category</option>
                  </Select>

                  {category === CUSTOM_OPTION_VALUE && (
                    <Input
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="Enter custom category name..."
                      className="bg-surface-raised/50 h-9 mt-1.5"
                      required
                    />
                  )}
                </div>
              </div>

              {/* Model Dropdown (Proxy or Vibration) */}
              {(category.startsWith("Proxy") || category === "Vibration Sensor") && (
                <div className="grid grid-cols-1 gap-4">
                  {category.startsWith("Proxy") && (
                    <div className="space-y-1">
                      <Label className="text-text-secondary font-semibold">
                        Proxy Model
                      </Label>
                      <Select
                        value={sensorType}
                        onChange={(e) => setSensorType(e.target.value)}
                        className="bg-surface-raised/50 h-9"
                      >
                        <option value="">Select proxy model...</option>
                        {PROXY_MODELS.map((pm) => (
                          <option key={pm} value={pm}>
                            {pm}
                          </option>
                        ))}
                        <option value={CUSTOM_OPTION_VALUE}>+ Add Custom Model</option>
                      </Select>

                      {sensorType === CUSTOM_OPTION_VALUE && (
                        <Input
                          value={customSensorType}
                          onChange={(e) => setCustomSensorType(e.target.value)}
                          placeholder="Enter custom proxy model..."
                          className="bg-surface-raised/50 h-9 mt-1.5"
                        />
                      )}
                    </div>
                  )}

                  {category === "Vibration Sensor" && (
                    <div className="space-y-1">
                      <Label className="text-text-secondary font-semibold">
                        Vibration Model
                      </Label>
                      <Select
                        value={sensorType}
                        onChange={(e) => setSensorType(e.target.value)}
                        className="bg-surface-raised/50 h-9"
                      >
                        <option value="">Select vibration model...</option>
                        {VIBRATION_MODELS.map((vm) => (
                          <option key={vm} value={vm}>
                            {vm}
                          </option>
                        ))}
                        <option value={CUSTOM_OPTION_VALUE}>+ Add Custom Model</option>
                      </Select>

                      {sensorType === CUSTOM_OPTION_VALUE && (
                        <Input
                          value={customSensorType}
                          onChange={(e) => setCustomSensorType(e.target.value)}
                          placeholder="Enter custom vibration model..."
                          className="bg-surface-raised/50 h-9 mt-1.5"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quantities & Pricing */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Actual Quantity <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={actualQuantity}
                    onChange={(e) =>
                      setActualQuantity(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g. 50"
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Minimum Quantity (Alert) <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={minQuantity}
                    onChange={(e) =>
                      setMinQuantity(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g. 10"
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Unit Price (₹) <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitPrice}
                    onChange={(e) =>
                      setUnitPrice(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g. 1500"
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>
              </div>

              {/* Auto-Calculated Valuation Banner */}
              <div className="p-3 rounded-xl bg-violet/10 border border-violet/20 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-secondary">
                  Auto-Calculated Total Valuation:
                </span>
                <span className="text-md font-extrabold text-violet font-mono">
                  ₹{autoCalculatedPrice.toLocaleString("en-IN")}
                </span>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <Label className="text-text-secondary font-semibold">Notes / Remark</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional details or batch notes..."
                  className="bg-surface-raised/50 h-9"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-border/70 flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  className="h-9 px-4 text-xs cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-5 text-xs bg-violet hover:bg-violet-dark text-white font-semibold flex items-center gap-1.5 cursor-pointer rounded-lg"
                >
                  {saving && <RefreshCw size={14} className="animate-spin" />}
                  {editingId ? "Update Item" : "Save Stock Item"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
