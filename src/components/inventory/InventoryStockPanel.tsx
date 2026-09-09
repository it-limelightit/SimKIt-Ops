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
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import logoUrl from "../../../image copy.png";
import {
  InventoryStockItem,
  PREDEFINED_CATEGORIES,
  PROXY_MODELS,
  VIBRATION_MODELS,
} from "@/lib/inventory-service";
import {
  calculateInventoryBom,
  InventoryBomItem,
} from "@/lib/inventory-bom-service";

const CUSTOM_OPTION_VALUE = "__custom__";

type InventoryEntryNotes = {
  inventory_entry_type?: string;
  bulk_order_group_id?: string;
  bulk_order_quantity?: number;
  bulk_order_items?: BulkOrderDraft[];
  bulk_order_price_source?: string;
  bulk_order_note?: string | null;
};

type BulkOrderDraft = {
  category: string;
  sensorType: string | null;
  quantity: number;
  unitPrice: number;
  priceSource: string;
  note: string | null;
};

type BulkOrderPlan = {
  id: string;
  device_quantity: number;
  order_date: string;
  created_at: string;
};

function parseInventoryEntryNotes(notes: string | null): InventoryEntryNotes {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isBulkOrderItem(item: InventoryStockItem) {
  return item.actual_quantity < 0 || parseInventoryEntryNotes(item.notes).inventory_entry_type === "bulk_order";
}

function getInventoryItemLabel(item: InventoryStockItem) {
  const notesData = parseInventoryEntryNotes(item.notes);
  if (notesData.bulk_order_items?.length) return `Bulk Inventory Order (${notesData.bulk_order_items.length} items)`;
  return item.sensor_type ? `${item.category} - ${item.sensor_type}` : item.category;
}

function getBulkOrderGroupId(item: InventoryStockItem) {
  return parseInventoryEntryNotes(item.notes).bulk_order_group_id || item.id;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function InventoryStockPanel() {
  const [stock, setStock] = useState<InventoryStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkOrderModalOpen, setIsBulkOrderModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBulkOrderId, setEditingBulkOrderId] = useState<string | null>(null);
  const [editingBulkOrderGroupId, setEditingBulkOrderGroupId] = useState<string | null>(null);
  const [editingBulkOrderExtraIds, setEditingBulkOrderExtraIds] = useState<string[]>([]);
  const [editingBulkDraftIndex, setEditingBulkDraftIndex] = useState<number | null>(null);
  
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
  const [bulkCategory, setBulkCategory] = useState(PREDEFINED_CATEGORIES[0]);
  const [bulkCustomCategory, setBulkCustomCategory] = useState("");
  const [bulkSensorType, setBulkSensorType] = useState("");
  const [bulkCustomSensorType, setBulkCustomSensorType] = useState("");
  const [bulkQuantity, setBulkQuantity] = useState<number | "">("");
  const [bulkPriceChoice, setBulkPriceChoice] = useState("");
  const [bulkCustomUnitPrice, setBulkCustomUnitPrice] = useState<number | "">("");
  const [bulkOrderDate, setBulkOrderDate] = useState(new Date().toISOString().split("T")[0]);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkOrderDrafts, setBulkOrderDrafts] = useState<BulkOrderDraft[]>([]);

  // BOM planning state is intentionally separate from physical stock and bulk orders.
  const [bomItems, setBomItems] = useState<InventoryBomItem[]>([]);
  const [bomUsageLogs, setBomUsageLogs] = useState<Array<{ stock_id: string | null; quantity_changed: number; change_type: string }>>([]);
  const [plannedKitQuantity, setPlannedKitQuantity] = useState<number | "">(0);
  const [bulkOrderDeviceQuantity, setBulkOrderDeviceQuantity] = useState<number | "">(0);
  const [savedBulkOrderPlan, setSavedBulkOrderPlan] = useState<BulkOrderPlan | null>(null);
  const [bomLoading, setBomLoading] = useState(false);
  const [isBomModalOpen, setIsBomModalOpen] = useState(false);
  const [bomCategory, setBomCategory] = useState(PREDEFINED_CATEGORIES[0]);
  const [bomQuantityPerKit, setBomQuantityPerKit] = useState<number | "">(1);
  const [bomUnit, setBomUnit] = useState("Nos");
  const [editingBomId, setEditingBomId] = useState<string | null>(null);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, error }, { data: logData, error: logError }] = await Promise.all([
        supabase.from("inventory_stock" as any).select("*").order("created_at", { ascending: false }),
        supabase.from("inventory_logs" as any).select("stock_id, quantity_changed, change_type"),
      ]);

      if (error) throw error;
      if (logError) throw logError;
      setStock((data ?? []) as unknown as InventoryStockItem[]);
      setBomUsageLogs((logData ?? []) as Array<{ stock_id: string | null; quantity_changed: number; change_type: string }>);
    } catch (e: any) {
      console.error("Error fetching inventory stock:", e);
      toast.error("Failed to load inventory stock data");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBom = useCallback(async () => {
    setBomLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_bom_items" as any)
        .select("*")
        .eq("product_name", "Data Meter")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setBomItems((data ?? []) as unknown as InventoryBomItem[]);
    } catch (e: any) {
      console.error("Error fetching BOM:", e);
      toast.error("Failed to load BOM. Apply the inventory BOM migration first.");
    } finally {
      setBomLoading(false);
    }
  }, []);

  const fetchLatestBulkOrderPlan = useCallback(async () => {
    const { data, error } = await supabase
      .from("inventory_bulk_order_plans" as any)
      .select("id, device_quantity, order_date, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Error fetching bulk order plan:", error);
      return;
    }
    if (data) {
      const plan = data as unknown as BulkOrderPlan;
      setSavedBulkOrderPlan(plan);
      setBulkOrderDeviceQuantity(plan.device_quantity);
      setBulkOrderDate(plan.order_date);
    }
  }, []);

  useEffect(() => {
    void fetchStock();
    void fetchBom();
    void fetchLatestBulkOrderPlan();
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
  }, [fetchStock, fetchBom, fetchLatestBulkOrderPlan]);

  const bomCalculations = useMemo(() => {
    const usageByStockId = new Map<string, number>();
    bomUsageLogs
      .filter((log) => log.change_type === "DISPATCH_DEDUCTION" && Number(log.quantity_changed) < 0 && log.stock_id)
      .forEach((log) => {
        const stockId = log.stock_id as string;
        usageByStockId.set(stockId, (usageByStockId.get(stockId) || 0) + Math.abs(Number(log.quantity_changed)));
      });
    const usage = bomUsageLogs
      .filter((log) => log.change_type === "DISPATCH_DEDUCTION" && Number(log.quantity_changed) < 0)
      .map((log) => {
        const stockItem = stock.find((item) => item.id === log.stock_id);
        return stockItem
          ? { category: stockItem.category, sensorType: stockItem.sensor_type, quantity: Math.abs(Number(log.quantity_changed)) }
          : null;
      })
      .filter((item): item is { category: string; sensorType: string | null; quantity: number } => Boolean(item));

    return calculateInventoryBom(bomItems, {
      plannedKitQuantity: Number(plannedKitQuantity) || 0,
      currentStock: stock
        .filter((item) => !isBulkOrderItem(item))
        .map((item) => ({
          category: item.category,
          sensor_type: item.sensor_type,
          // actual_quantity is already reduced by dispatch; add the audit usage back
          // so the calculator receives Excel's Total Available value.
          actual_quantity: item.actual_quantity + (usageByStockId.get(item.id) || 0),
        })),
      usage,
    });
  }, [bomItems, bomUsageLogs, plannedKitQuantity, stock]);

  const resetBomForm = () => {
    setEditingBomId(null);
    setBomCategory(PREDEFINED_CATEGORIES[0]);
    setBomQuantityPerKit(1);
    setBomUnit("Nos");
  };

  const handleSaveBomItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomCategory.trim() || bomQuantityPerKit === "" || Number(bomQuantityPerKit) < 0) {
      toast.error("Enter a valid BOM category and quantity per kit");
      return;
    }
    setBomLoading(true);
    try {
      const payload = {
        product_name: "Data Meter",
        category: bomCategory.trim(),
        sensor_type: null,
        quantity_per_kit: Number(bomQuantityPerKit),
        unit: bomUnit.trim() || "Nos",
        required_by_default: true,
        min_quantity: 0,
        active: true,
        updated_at: new Date().toISOString(),
      };
      const query = editingBomId
        ? supabase.from("inventory_bom_items" as any).update(payload).eq("id", editingBomId)
        : supabase.from("inventory_bom_items" as any).insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast.success(editingBomId ? "BOM item updated" : "BOM item added");
      resetBomForm();
      setIsBomModalOpen(false);
      await fetchBom();
    } catch (e: any) {
      toast.error("Failed to save BOM item: " + e.message);
    } finally {
      setBomLoading(false);
    }
  };

  const handleEditBomItem = (item: InventoryBomItem) => {
    setEditingBomId(item.id);
    setBomCategory(item.category);
    setBomSensorType(item.sensor_type || "");
    setBomQuantityPerKit(item.quantity_per_kit);
    setBomUnit(item.unit);
    setBomRequiredByDefault(item.required_by_default);
    setIsBomModalOpen(true);
  };

  const handleDeleteBomItem = async (item: InventoryBomItem) => {
    if (!confirm(`Remove ${item.category} from the Data Meter BOM?`)) return;
    const { error } = await supabase.from("inventory_bom_items" as any).delete().eq("id", item.id);
    if (error) toast.error("Failed to delete BOM item: " + error.message);
    else {
      toast.success("BOM item removed");
      await fetchBom();
    }
  };


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

  const resetBulkOrderForm = () => {
    setEditingBulkOrderId(null);
    setEditingBulkOrderGroupId(null);
    setEditingBulkOrderExtraIds([]);
    setEditingBulkDraftIndex(null);
    setBulkCategory(PREDEFINED_CATEGORIES[0]);
    setBulkCustomCategory("");
    setBulkSensorType("");
    setBulkCustomSensorType("");
    setBulkQuantity("");
    setBulkPriceChoice("");
    setBulkCustomUnitPrice("");
    setBulkOrderDate(new Date().toISOString().split("T")[0]);
    setBulkNotes("");
    setBulkOrderDrafts([]);
  };

  const handleOpenBulkOrderModal = () => {
    resetBulkOrderForm();
    setIsBulkOrderModalOpen(true);
  };

  const clearBulkLineForm = () => {
    setEditingBulkDraftIndex(null);
    setBulkCategory(PREDEFINED_CATEGORIES[0]);
    setBulkCustomCategory("");
    setBulkSensorType("");
    setBulkCustomSensorType("");
    setBulkQuantity("");
    setBulkPriceChoice("");
    setBulkCustomUnitPrice("");
    setBulkNotes("");
  };

  const handleEditBulkItem = (item: InventoryStockItem) => {
    const notesData = parseInventoryEntryNotes(item.notes);
    const quantity = Math.abs(Number(notesData.bulk_order_quantity || item.actual_quantity || 0));
    const draftItems = notesData.bulk_order_items?.length
      ? notesData.bulk_order_items
      : [
          {
            category: item.category,
            sensorType: item.sensor_type || null,
            quantity,
            unitPrice: Number(item.unit_price) || 0,
            priceSource: notesData.bulk_order_price_source || "current",
            note: notesData.bulk_order_note || null,
          },
        ];
    setEditingBulkOrderId(item.id);
    setEditingBulkOrderGroupId(getBulkOrderGroupId(item));
    setEditingBulkOrderExtraIds(
      computedStock
        .filter((row) => isBulkOrderItem(row) && getBulkOrderGroupId(row) === getBulkOrderGroupId(item) && row.id !== item.id)
        .map((row) => row.id),
    );
    setEditingBulkDraftIndex(null);
    setBulkOrderDate(item.entry_date || new Date().toISOString().split("T")[0]);
    setBulkOrderDrafts(draftItems);
    setBulkCategory(PREDEFINED_CATEGORIES[0]);
    setBulkCustomCategory("");
    setBulkSensorType("");
    setBulkCustomSensorType("");
    setBulkQuantity("");
    setBulkPriceChoice("");
    setBulkCustomUnitPrice("");
    setBulkNotes("");
    setIsBulkOrderModalOpen(true);
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

  const handleDeleteBulkOrder = async (item: InventoryStockItem) => {
    const groupId = getBulkOrderGroupId(item);
    const ids = computedStock
      .filter((row) => isBulkOrderItem(row) && getBulkOrderGroupId(row) === groupId)
      .map((row) => row.id);
    const deleteIds = ids.length ? ids : [item.id];

    if (!confirm("Are you sure you want to delete this bulk order?")) return;
    try {
      const { error } = await supabase
        .from("inventory_stock" as any)
        .delete()
        .in("id", deleteIds);
      if (error) throw error;
      toast.success("Bulk order deleted");
      void fetchStock();
    } catch (e: any) {
      toast.error("Failed to delete bulk order: " + e.message);
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

  const getFinalBulkCategory = () =>
    bulkCategory === CUSTOM_OPTION_VALUE ? bulkCustomCategory.trim() : bulkCategory;

  const getFinalBulkSensorType = () => {
    if (!(bulkCategory.startsWith("Proxy") || bulkCategory === "Vibration Sensor")) return null;
    const finalSensorType = bulkSensorType === CUSTOM_OPTION_VALUE ? bulkCustomSensorType.trim() : bulkSensorType;
    return finalSensorType || null;
  };

  // Live Calculations (KTA Analytics)
  const computedStock = useMemo(() => {
    return stock.map((s) => ({
      ...s,
      total_price: Number(s.actual_quantity) * Number(s.unit_price),
    }));
  }, [stock]);

  const [statusFilter, setStatusFilter] = useState<"all" | "low">("all");

  const filteredStock = useMemo(() => {
    return computedStock.filter((item) => {
      const isBulkOrder = isBulkOrderItem(item);
      const matchesSearch =
        item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.sensor_type && item.sensor_type.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCat = categoryFilter === "all" || item.category === categoryFilter;

      let matchesStatus = !isBulkOrder;
      if (statusFilter === "low") {
        matchesStatus = !isBulkOrder && item.actual_quantity <= item.min_quantity && item.actual_quantity > 0;
      }

      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [computedStock, searchQuery, categoryFilter, statusFilter]);

  const displayStock = useMemo(() => {
    const rows: InventoryStockItem[] = [];
    const bulkGroups = new Map<string, InventoryStockItem[]>();

    filteredStock.forEach((item) => {
      if (!isBulkOrderItem(item)) {
        rows.push(item);
        return;
      }
      const groupId = getBulkOrderGroupId(item);
      bulkGroups.set(groupId, [...(bulkGroups.get(groupId) || []), item]);
    });

    bulkGroups.forEach((items) => {
      const first = items[0];
      const draftItems = items.flatMap((item) => {
        const notesData = parseInventoryEntryNotes(item.notes);
        if (notesData.bulk_order_items?.length) return notesData.bulk_order_items;
        return [{
          category: item.category,
          sensorType: item.sensor_type || null,
          quantity: Math.abs(Number(notesData.bulk_order_quantity || item.actual_quantity || 0)),
          unitPrice: Number(item.unit_price) || 0,
          priceSource: notesData.bulk_order_price_source || "current",
          note: notesData.bulk_order_note || null,
        }];
      });
      const totalQuantity = draftItems.reduce((sum, draft) => sum + draft.quantity, 0);
      const totalAmount = draftItems.reduce((sum, draft) => sum + draft.quantity * draft.unitPrice, 0);

      rows.push({
        ...first,
        category: "Bulk Inventory Order",
        sensor_type: `${draftItems.length} items`,
        actual_quantity: -totalQuantity,
        unit_price: totalQuantity > 0 ? totalAmount / totalQuantity : 0,
        total_price: totalAmount,
        notes: JSON.stringify({
          inventory_entry_type: "bulk_order",
          bulk_order_group_id: getBulkOrderGroupId(first),
          bulk_order_quantity: totalQuantity,
          bulk_order_items: draftItems,
        } satisfies InventoryEntryNotes),
      });
    });

    return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [filteredStock]);

  const combinedInventoryRows = useMemo(() => {
    const rows: Array<{ bom: (typeof bomCalculations)[number] | null; stock: InventoryStockItem | null }> = [];
    const matchedStockIds = new Set<string>();
    const matches = (bom: (typeof bomCalculations)[number], item: InventoryStockItem) =>
      bom.category.trim().toLowerCase() === item.category.trim().toLowerCase() &&
      (bom.sensor_type || "").trim().toLowerCase() === (item.sensor_type || "").trim().toLowerCase();

    bomCalculations.forEach((bom) => {
      const matchingStock = displayStock.find((item) => !isBulkOrderItem(item) && matches(bom, item));
      if (matchingStock) matchedStockIds.add(matchingStock.id);
      rows.push({ bom, stock: matchingStock || null });
    });
    displayStock.filter((item) => !isBulkOrderItem(item) && !matchedStockIds.has(item.id)).forEach((item) => {
      rows.push({ bom: null, stock: item });
    });
    return rows;
  }, [bomCalculations, displayStock]);

  const ktaMetrics = useMemo(() => {
    let totalValuation = 0;
    let lowStockCount = 0;
    let bulkOrderQuantity = 0;
    const materialStock = computedStock.filter((item) => !isBulkOrderItem(item));

    materialStock.forEach((item) => {
      totalValuation += item.total_price;
      if (item.actual_quantity <= item.min_quantity && item.actual_quantity > 0) lowStockCount++;
    });
    computedStock.forEach((item) => {
      if (isBulkOrderItem(item)) {
        bulkOrderQuantity += Math.abs(item.actual_quantity);
      }
    });

    const requiredComponents = bomItems.filter((item) => item.active && item.required_by_default && item.quantity_per_kit > 0);
    const completeDmCount = requiredComponents.length
      ? Math.min(...requiredComponents.map((bom) => {
          const available = materialStock
            .filter((stockItem) =>
              stockItem.category.trim().toLowerCase() === bom.category.trim().toLowerCase() &&
              (stockItem.sensor_type || "").trim().toLowerCase() === (bom.sensor_type || "").trim().toLowerCase(),
            )
            .reduce((sum, stockItem) => sum + Math.max(0, Number(stockItem.actual_quantity) || 0), 0);
          return Math.floor(available / bom.quantity_per_kit);
        }))
      : 0;

    return { totalItems: completeDmCount, totalValuation, lowStockCount, bulkOrderQuantity };
  }, [bomItems, computedStock]);

  const availableBulkUnitPrices = useMemo(() => {
    const finalCategory = getFinalBulkCategory();
    const finalSensorType = getFinalBulkSensorType();
    const prices = new Set<number>();

    computedStock.forEach((item) => {
      if (isBulkOrderItem(item)) return;
      if (item.category !== finalCategory) return;
      if ((item.sensor_type || null) !== finalSensorType) return;
      const price = Number(item.unit_price);
      if (price > 0) prices.add(price);
    });

    return Array.from(prices).sort((a, b) => b - a);
  }, [computedStock, bulkCategory, bulkCustomCategory, bulkSensorType, bulkCustomSensorType]);

  const selectedBulkUnitPrice = useMemo(() => {
    if (bulkPriceChoice === CUSTOM_OPTION_VALUE) return Number(bulkCustomUnitPrice) || 0;
    if (bulkPriceChoice) return Number(bulkPriceChoice) || 0;
    return availableBulkUnitPrices[0] || 0;
  }, [availableBulkUnitPrices, bulkCustomUnitPrice, bulkPriceChoice]);

  const bulkOrderTotal = useMemo(() => {
    const qty = Number(bulkQuantity) || 0;
    return qty * selectedBulkUnitPrice;
  }, [bulkQuantity, selectedBulkUnitPrice]);

  const bulkDraftTotal = useMemo(
    () => bulkOrderDrafts.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [bulkOrderDrafts],
  );

  const bulkDraftQuantity = useMemo(
    () => bulkOrderDrafts.reduce((sum, item) => sum + item.quantity, 0),
    [bulkOrderDrafts],
  );

  const handleSaveBulkOrderPlan = async () => {
    const deviceQuantity = Number(bulkOrderDeviceQuantity);
    if (!Number.isInteger(deviceQuantity) || deviceQuantity <= 0) {
      toast.error("Enter a valid bulk order device quantity");
      return;
    }
    if (!bulkOrderDate) {
      toast.error("Select a bulk order date");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("inventory_bulk_order_plans" as any)
        .insert({ device_quantity: deviceQuantity, order_date: bulkOrderDate })
        .select("id, device_quantity, order_date, created_at")
        .single();
      if (error) throw error;
      setSavedBulkOrderPlan(data as unknown as BulkOrderPlan);
      toast.success("Bulk order plan saved.");
    } catch (e: any) {
      toast.error("Failed to save bulk order plan: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const downloadBulkOrderPlanPdf = async () => {
    const deviceQuantity = Number(bulkOrderDeviceQuantity);
    if (!Number.isInteger(deviceQuantity) || deviceQuantity <= 0) {
      toast.error("Enter a valid bulk order device quantity first");
      return;
    }

    try {
      const reportItems = bomCalculations
        .filter((bom) => bom.required_by_default && bom.quantity_per_kit > 0)
        .map((bom) => {
          const item = stock.find((stockItem) =>
            !isBulkOrderItem(stockItem) &&
            stockItem.category.trim().toLowerCase() === bom.category.trim().toLowerCase() &&
            (stockItem.sensor_type || "").trim().toLowerCase() === (bom.sensor_type || "").trim().toLowerCase(),
          );
          const quantity = bom.quantity_per_kit * deviceQuantity;
          const unitPrice = Number(item?.unit_price) || 0;
          return {
            category: bom.sensor_type ? `${bom.category} - ${bom.sensor_type}` : bom.category,
            currentQuantity: bom.current_quantity,
            quantity,
            unitPrice,
            total: quantity * unitPrice,
          };
        });

      if (!reportItems.length) {
        toast.error("Add required BOM components before generating the report");
        return;
      }

      const [{ jsPDF }] = await Promise.all([import("jspdf")]);
      const logoDataUrl = await fetch(logoUrl)
        .then((response) => response.blob())
        .then((blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }));
      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 45;
      const tableWidth = pageWidth - margin * 2;
      const navy: [number, number, number] = [23, 58, 91];
      const ink: [number, number, number] = [31, 51, 71];
      const muted: [number, number, number] = [102, 120, 138];
      const border: [number, number, number] = [215, 224, 232];
      const columns = [
        { label: "Component", width: 170 },
        { label: "Current Qty", width: 75 },
        { label: "Bulk Order", width: 75 },
        { label: "Unit Price", width: 75 },
        { label: "Total", width: 85 },
      ];

      doc.addImage(logoDataUrl, "PNG", margin, 26, 42, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...navy);
      doc.text("LimelightIT Research Pvt. Ltd.", margin + 52, 43);
      doc.setFontSize(15);
      doc.text("DATA METER BULK ORDER REPORT", pageWidth / 2, 92, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...muted);
      doc.text(`Order Date: ${formatDisplayDate(bulkOrderDate)}`, pageWidth - margin, 55, { align: "right" });
      doc.text(`Planned Data Meters: ${deviceQuantity}`, pageWidth / 2, 110, { align: "center" });

      let y = 128;
      doc.setFillColor(...navy);
      doc.roundedRect(margin, y, tableWidth, 28, 3, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      let x = margin;
      columns.forEach((column, index) => {
        doc.text(column.label, x + 8, y + 18);
        if (index > 0) doc.line(x, y, x, y + 28);
        x += column.width;
      });
      y += 28;

      reportItems.forEach((item) => {
        const rowHeight = 36;
        if (y + rowHeight > pageHeight - 48) {
          doc.addPage();
          y = 48;
        }
        const values = [
          item.category,
          String(item.currentQuantity),
          String(item.quantity),
          `Rs. ${item.unitPrice.toLocaleString("en-IN")}`,
          `Rs. ${item.total.toLocaleString("en-IN")}`,
        ];
        doc.setDrawColor(...border);
        doc.setLineWidth(0.55);
        doc.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
        x = margin;
        columns.forEach((column, index) => {
          if (index > 0) doc.line(x, y, x, y + rowHeight);
          doc.setFont("helvetica", index === 0 ? "bold" : "normal");
          doc.setFontSize(8.2);
          doc.setTextColor(...ink);
          doc.text(doc.splitTextToSize(values[index], column.width - 14).slice(0, 2), x + 8, y + 21);
          x += column.width;
        });
        y += rowHeight;
      });

      const totalQuantity = reportItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = reportItems.reduce((sum, item) => sum + item.total, 0);
      y += 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...navy);
      doc.text(`Total Bulk Order Quantity: ${totalQuantity}`, margin, y);
      doc.text(`Total Amount: Rs. ${totalAmount.toLocaleString("en-IN")}`, pageWidth - margin, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text("Generated from SIMKit Ops inventory BOM planning.", margin, pageHeight - 22);
      doc.save(`data-meter-bulk-order-${bulkOrderDate}.pdf`);
      toast.success("Bulk order report downloaded.");
    } catch (e: any) {
      toast.error("Failed to generate bulk order report: " + (e.message || e));
    }
  };

  const getCurrentQuantityForBulkDraft = (draft: BulkOrderDraft) => {
    return computedStock.reduce((sum, stockItem) => {
      if (isBulkOrderItem(stockItem)) return sum;
      if (stockItem.category !== draft.category) return sum;
      if ((stockItem.sensor_type || null) !== (draft.sensorType || null)) return sum;
      return sum + Number(stockItem.actual_quantity || 0);
    }, 0);
  };

  const downloadBulkOrderPdf = async (item: InventoryStockItem) => {
    try {
      const rootNotes = parseInventoryEntryNotes(item.notes);
      const groupId = getBulkOrderGroupId(item);
      const groupedRows = computedStock
        .filter((row) => isBulkOrderItem(row) && getBulkOrderGroupId(row) === groupId);
      const reportItems = rootNotes.bulk_order_items?.length
        ? rootNotes.bulk_order_items
        : (groupedRows.length ? groupedRows : [item]).map((row) => {
            const notesData = parseInventoryEntryNotes(row.notes);
            return {
              category: row.category,
              sensorType: row.sensor_type || null,
              quantity: Math.abs(Number(notesData.bulk_order_quantity || row.actual_quantity || 0)),
              unitPrice: Number(row.unit_price) || 0,
              priceSource: notesData.bulk_order_price_source || "current",
              note: notesData.bulk_order_note || null,
            };
          });
      const [{ jsPDF }] = await Promise.all([import("jspdf")]);
      const logoDataUrl = await fetch(logoUrl)
        .then((response) => response.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }),
        );
      const watermarkDataUrl = await new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 700;
          canvas.height = 700;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Could not prepare watermark."));
            return;
          }
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.globalAlpha = 0.12;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        image.onerror = () => reject(new Error("Could not load company watermark."));
        image.src = logoDataUrl;
      });

      const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const navy: [number, number, number] = [23, 58, 91];
      const ink: [number, number, number] = [31, 51, 71];
      const muted: [number, number, number] = [102, 120, 138];
      const border: [number, number, number] = [215, 224, 232];
      const marginX = 45;
      const tableWidth = pageWidth - marginX * 2;

      doc.addImage(watermarkDataUrl, "PNG", pageWidth / 2 - 145, pageHeight / 2 - 145, 290, 290);
      doc.addImage(logoDataUrl, "PNG", marginX, 26, 42, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...navy);
      doc.text("LimelightIT Research Pvt. Ltd.", marginX + 52, 43);
      doc.setFontSize(15);
      doc.text("BULK INVENTORY ORDER", pageWidth / 2, 92, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...muted);
      doc.text(`Order Date: ${formatDisplayDate(item.entry_date)}`, pageWidth - marginX, 55, { align: "right" });
      doc.text(`Items: ${reportItems.length}`, pageWidth / 2, 110, { align: "center" });

      const columns = [
        { label: "Date", width: 58 },
        { label: "Inventory Category", width: 158 },
        { label: "Current Qty", width: 70 },
        { label: "Wanted Qty", width: 62 },
        { label: "Unit Price", width: 72 },
        { label: "Total", width: 72 },
      ];

      let y = 128;
      doc.setFillColor(...navy);
      doc.roundedRect(marginX, y, tableWidth, 28, 3, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      let x = marginX;
      columns.forEach((column, index) => {
        doc.text(column.label, x + 8, y + 18);
        if (index > 0) doc.line(x, y, x, y + 28);
        x += column.width;
      });
      y += 28;

      reportItems.forEach((reportItem) => {
        const requestedQuantity = Math.abs(Number(reportItem.quantity || 0));
        const rowValues = [
          formatDisplayDate(item.entry_date),
          reportItem.sensorType ? `${reportItem.category} - ${reportItem.sensorType}` : reportItem.category,
          String(getCurrentQuantityForBulkDraft(reportItem)),
          `-${requestedQuantity}`,
          Number(reportItem.unitPrice).toLocaleString("en-IN"),
          (requestedQuantity * Number(reportItem.unitPrice)).toLocaleString("en-IN"),
        ];
        const rowHeight = 42;

        if (y + rowHeight > pageHeight - 48) {
          doc.addPage();
          doc.addImage(watermarkDataUrl, "PNG", pageWidth / 2 - 145, pageHeight / 2 - 145, 290, 290);
          y = 48;
        }

        doc.setDrawColor(...border);
        doc.setLineWidth(0.55);
        doc.line(marginX, y + rowHeight, marginX + tableWidth, y + rowHeight);
        x = marginX;
        columns.forEach((column, columnIndex) => {
          if (columnIndex > 0) doc.line(x, y, x, y + rowHeight);
          doc.setFont("helvetica", columnIndex === 1 ? "bold" : "normal");
          doc.setFontSize(8.2);
          doc.setTextColor(columnIndex === 1 ? navy[0] : ink[0], columnIndex === 1 ? navy[1] : ink[1], columnIndex === 1 ? navy[2] : ink[2]);
          doc.text(doc.splitTextToSize(rowValues[columnIndex], column.width - 14).slice(0, 2), x + 8, y + 20);
          x += column.width;
        });
        y += rowHeight;
      });

      const totalQuantity = reportItems.reduce((sum, reportItem) => {
        return sum + Math.abs(Number(reportItem.quantity || 0));
      }, 0);
      const totalAmount = reportItems.reduce((sum, reportItem) => {
        const requestedQuantity = Math.abs(Number(reportItem.quantity || 0));
        return sum + requestedQuantity * Number(reportItem.unitPrice);
      }, 0);

      y += 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...navy);
      doc.text(`Total Wanted Quantity: -${totalQuantity}`, marginX, y);
      doc.text(`Total Amount: ${totalAmount.toLocaleString("en-IN")}`, pageWidth - marginX, y, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text("Generated from SIMKit Ops inventory bulk order.", marginX, pageHeight - 22);
      doc.text("Page 1 / 1", pageWidth - marginX, pageHeight - 22, { align: "right" });

      doc.save(`bulk-inventory-order-report-${formatDisplayDate(item.entry_date).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
      toast.success("Bulk order PDF downloaded.");
    } catch (e: any) {
      toast.error("Failed to generate bulk order PDF: " + (e.message || e));
    }
  };

  const addBulkDraftLine = () => {
    const finalCategory = getFinalBulkCategory();
    const finalSensorType = getFinalBulkSensorType();
    const requestedQuantity = Number(bulkQuantity);

    if (!finalCategory) {
      toast.error("Please select an inventory category");
      return false;
    }
    if (!requestedQuantity || requestedQuantity <= 0) {
      toast.error("Please enter a valid bulk order quantity");
      return false;
    }
    if (selectedBulkUnitPrice <= 0) {
      toast.error("Please select current price or add custom price");
      return false;
    }

    const nextDraft: BulkOrderDraft = {
      category: finalCategory,
      sensorType: finalSensorType,
      quantity: requestedQuantity,
      unitPrice: selectedBulkUnitPrice,
      priceSource: bulkPriceChoice === CUSTOM_OPTION_VALUE ? "custom" : "current",
      note: bulkNotes.trim() || null,
    };

    setBulkOrderDrafts((current) => {
      if (editingBulkDraftIndex === null) return [...current, nextDraft];
      return current.map((draft, index) => (index === editingBulkDraftIndex ? nextDraft : draft));
    });
    clearBulkLineForm();
    return true;
  };

  const editBulkDraftLine = (draft: BulkOrderDraft, index: number) => {
    setEditingBulkDraftIndex(index);
    setBulkCategory(PREDEFINED_CATEGORIES.includes(draft.category) ? draft.category : CUSTOM_OPTION_VALUE);
    setBulkCustomCategory(PREDEFINED_CATEGORIES.includes(draft.category) ? "" : draft.category);
    setBulkSensorType(draft.sensorType || "");
    setBulkCustomSensorType("");
    setBulkQuantity(draft.quantity);
    setBulkPriceChoice(CUSTOM_OPTION_VALUE);
    setBulkCustomUnitPrice(draft.unitPrice);
    setBulkNotes(draft.note || "");
  };

  const removeBulkDraftLine = (index: number) => {
    setBulkOrderDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (editingBulkDraftIndex === index) clearBulkLineForm();
  };

  const handleSaveBulkOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    let draftsToSave = bulkOrderDrafts;
    if (bulkQuantity !== "" || bulkNotes.trim() || bulkPriceChoice === CUSTOM_OPTION_VALUE) {
      const finalCategory = getFinalBulkCategory();
      const finalSensorType = getFinalBulkSensorType();
      const requestedQuantity = Number(bulkQuantity);
      if (!finalCategory) {
        toast.error("Please select an inventory category");
        return;
      }
      if (!requestedQuantity || requestedQuantity <= 0) {
        toast.error("Please enter a valid bulk order quantity");
        return;
      }
      if (selectedBulkUnitPrice <= 0) {
        toast.error("Please select current price or add custom price");
        return;
      }

      const currentDraft = {
        category: finalCategory,
        sensorType: finalSensorType,
        quantity: requestedQuantity,
        unitPrice: selectedBulkUnitPrice,
        priceSource: bulkPriceChoice === CUSTOM_OPTION_VALUE ? "custom" : "current",
        note: bulkNotes.trim() || null,
      };

      if (editingBulkOrderId) {
        draftsToSave = [currentDraft];
      } else if (editingBulkDraftIndex === null) {
        draftsToSave = [...bulkOrderDrafts, currentDraft];
      } else {
        draftsToSave = bulkOrderDrafts.map((draft, index) => (index === editingBulkDraftIndex ? currentDraft : draft));
      }
    }

    if (!draftsToSave.length) {
      toast.error("Add at least one bulk order line");
      return;
    }

    setSaving(true);
    try {
      const bulkOrderGroupId =
        editingBulkOrderGroupId ||
        editingBulkOrderId ||
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const totalQuantity = draftsToSave.reduce((sum, draft) => sum + draft.quantity, 0);
      const totalAmount = draftsToSave.reduce((sum, draft) => sum + draft.quantity * draft.unitPrice, 0);
      const toPayload = () => ({
        category: "Bulk Inventory Order",
        sensor_type: null,
        actual_quantity: -totalQuantity,
        min_quantity: 0,
        unit_price: totalQuantity > 0 ? totalAmount / totalQuantity : 0,
        entry_date: bulkOrderDate,
        notes: JSON.stringify({
          inventory_entry_type: "bulk_order",
          bulk_order_group_id: bulkOrderGroupId,
          bulk_order_quantity: totalQuantity,
          bulk_order_items: draftsToSave,
        } satisfies InventoryEntryNotes),
        updated_at: new Date().toISOString(),
      });

      const { error } = editingBulkOrderId
        ? await supabase.from("inventory_stock" as any).update(toPayload()).eq("id", editingBulkOrderId)
        : await supabase.from("inventory_stock" as any).insert(toPayload());

      if (error) throw error;
      if (editingBulkOrderExtraIds.length) {
        const { error: cleanupError } = await supabase
          .from("inventory_stock" as any)
          .delete()
          .in("id", editingBulkOrderExtraIds);
        if (cleanupError) throw cleanupError;
      }
      toast.success(editingBulkOrderId ? "Bulk order updated successfully" : "Bulk order saved successfully");
      setIsBulkOrderModalOpen(false);
      resetBulkOrderForm();
      void fetchStock();
    } catch (e: any) {
      toast.error("Failed to save bulk order: " + e.message);
    } finally {
      setSaving(false);
    }
  };


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
              {ktaMetrics.totalItems} <span className="text-xs font-normal text-text-muted">DMs</span>
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
          className="p-4 border border-border/70 bg-surface-raised/30"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">Bulk Order DMs</p>
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400 ml-auto">
              <AlertCircle size={20} />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div className="min-w-0">
              <Input
                type="number"
                min="0"
                value={bulkOrderDeviceQuantity}
                onChange={(e) => setBulkOrderDeviceQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                className="h-9 w-full min-w-0 bg-surface-raised/50 text-xl font-extrabold text-rose-400"
                aria-label="Bulk order Data Meter quantity"
              />
              <p className="mt-1 text-[10px] text-text-muted">Required component quantity</p>
            </div>
            <Input
              type="date"
              value={bulkOrderDate}
              onChange={(e) => setBulkOrderDate(e.target.value)}
              className="h-9 w-full min-w-0 bg-surface-raised/50 text-[10px]"
              aria-label="Bulk order date"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[10px] text-text-muted">
              {savedBulkOrderPlan ? `Saved: ${formatDisplayDate(savedBulkOrderPlan.order_date)}` : "Not saved yet"}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                onClick={() => void downloadBulkOrderPlanPdf()}
                disabled={Number(bulkOrderDeviceQuantity) <= 0}
                variant="outline"
                className="h-7 px-2 text-[10px]"
                title="Download bulk order PDF report"
              >
                <FileText size={13} /> PDF
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveBulkOrderPlan()}
                disabled={saving || Number(bulkOrderDeviceQuantity) <= 0}
                className="h-7 px-2 text-[10px] bg-violet hover:bg-violet-dark text-white"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Card>

      </div>

      {/* Control Bar: Filters & Add Stock Action */}
      <Card className="p-4 border border-border/80 bg-surface flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto flex-1">
          <div className="relative w-full sm:w-72">
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
              className="bg-surface-raised/40 text-xs h-9 w-full sm:w-52"
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

        <div className="flex items-center justify-end gap-2 w-full lg:w-auto shrink-0">
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

      <Card className="border border-border/80 bg-surface overflow-hidden">
        <div className="p-4 border-b border-border/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-text-primary">Data Meter BOM Planning</h2>
            <p className="text-xs text-text-secondary mt-1">Plan new Data Meters and see which required components may need purchasing. This does not create a bulk order.</p>
          </div>
          <Button type="button" onClick={() => { resetBomForm(); setIsBomModalOpen(true); }} className="h-9 px-3 text-xs bg-violet hover:bg-violet-dark text-white flex items-center gap-1.5">
            <Plus size={14} /> Add DM Component
          </Button>
        </div>

        <div className="m-4 p-4 border border-violet/30 bg-violet/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-violet">Production Plan</p>
            <p className="text-xs text-text-secondary mt-1">Enter only the number of new Data Meters you plan to build.</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-text-secondary whitespace-nowrap">New DMs to build</Label>
            <Input type="number" min="0" value={plannedKitQuantity} onChange={(e) => setPlannedKitQuantity(e.target.value === "" ? "" : Number(e.target.value))} className="h-9 w-28 bg-surface-raised/50" aria-label="Planned Data Meter quantity" />
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border/70 bg-violet/5 text-[11px] text-text-secondary grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <span><strong className="text-text-primary">Total Available:</strong> stock before logged usage</span>
          <span><strong className="text-text-primary">Used Qty:</strong> stock consumed by dispatched orders</span>
          <span><strong className="text-text-primary">Required for Plan:</strong> quantity needed for required components only</span>
        </div>

        {isBomModalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <form onSubmit={handleSaveBomItem} className="w-full max-w-3xl rounded-xl border border-border bg-surface p-5 shadow-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">DM Component</Label>
            <Select value={bomCategory} onChange={(e) => setBomCategory(e.target.value)} className="h-9 bg-surface-raised/50">
              {PREDEFINED_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Qty / Kit</Label>
            <Input type="number" min="0" step="0.01" value={bomQuantityPerKit} onChange={(e) => setBomQuantityPerKit(e.target.value === "" ? "" : Number(e.target.value))} className="h-9 bg-surface-raised/50" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-text-secondary">Unit</Label>
            <Input value={bomUnit} onChange={(e) => setBomUnit(e.target.value)} className="h-9 bg-surface-raised/50" />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2 border-t border-border/70 pt-3 mt-2">
            <Button type="button" variant="outline" onClick={() => { resetBomForm(); setIsBomModalOpen(false); }} className="h-9 px-4 text-xs">Cancel</Button>
            <Button type="submit" disabled={bomLoading} className="h-9 px-4 text-xs bg-violet hover:bg-violet-dark text-white">{editingBomId ? "Update Component" : "Save Component"}</Button>
          </div>
        </form>
        </div>}

        <div className="overflow-x-auto">
          {bomLoading && bomItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">Loading BOM...</div>
          ) : combinedInventoryRows.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">Add inventory items or BOM components to populate this table.</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse min-w-[1450px]">
              <thead className="bg-surface-raised/40 text-text-secondary uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3">Entry Date</th>
                  <th className="p-3">Bulk Order Date</th>
                  <th className="p-3">Component</th>
                  <th className="p-3 text-center">Qty / Kit</th>
                  <th className="p-3 text-center">Total Available</th>
                  <th className="p-3 text-center">In Stock</th>
                  <th className="p-3 text-center">Min Threshold</th>
                  <th className="p-3 text-center">Used Qty</th>
                  <th className="p-3 text-center">Required for Plan</th>
                  <th className="p-3 text-center">Bulk Order</th>
                  <th className="p-3 text-center">Balance</th>
                  <th className="p-3 text-center">Shortage</th>
                  <th className="p-3 text-center">Order Qty</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Unit Price</th>
                  <th className="p-3 text-right">Stock Value</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {combinedInventoryRows.map(({ bom, stock: stockItem }) => {
                  const itemName = bom?.category || stockItem?.category || "-";
                  const stockQuantity = stockItem?.actual_quantity ?? (bom ? bom.balance_quantity : 0);
                  const minQuantity = stockItem?.min_quantity ?? bom?.min_quantity ?? 0;
                  const status = bom?.status || (stockQuantity <= 0 ? "OUT OF STOCK" : stockQuantity <= minQuantity ? "LOW STOCK" : "AVAILABLE");
                  return (
                    <tr key={`${bom?.id || "stock"}-${stockItem?.id || itemName}`} className="hover:bg-surface-raised/20">
                      <td className="p-3 whitespace-nowrap text-text-secondary font-mono">{stockItem?.entry_date ? formatDisplayDate(stockItem.entry_date) : "-"}</td>
                      <td className="p-3 whitespace-nowrap text-text-secondary font-mono">{bom && Number(bulkOrderDeviceQuantity) > 0 ? formatDisplayDate(bulkOrderDate) : "-"}</td>
                      <td className="p-3 font-semibold text-text-primary">{itemName}{(bom?.sensor_type || stockItem?.sensor_type) ? <span className="block text-[10px] text-violet">{bom?.sensor_type || stockItem?.sensor_type}</span> : null}</td>
                      <td className="p-3 text-center font-mono">{bom ? `${bom.quantity_per_kit} ${bom.unit}` : "-"}</td>
                      <td className="p-3 text-center font-mono">{bom ? bom.current_quantity : "-"}</td>
                      <td className="p-3 text-center font-mono font-bold">{stockQuantity}</td>
                      <td className="p-3 text-center font-mono">{minQuantity}</td>
                      <td className="p-3 text-center font-mono text-amber-300">{bom ? bom.actual_used_quantity : "-"}</td>
                      <td className="p-3 text-center font-mono">{bom ? bom.required_for_plan : "-"}</td>
                      <td className="p-3 text-center font-mono font-bold text-rose-300">{bom ? (bom.required_by_default ? bom.quantity_per_kit * (Number(bulkOrderDeviceQuantity) || 0) : 0) : "-"}</td>
                      <td className={`p-3 text-center font-mono font-bold ${bom && bom.balance_quantity <= 0 ? "text-rose-400" : "text-emerald-400"}`}>{bom ? bom.balance_quantity : "-"}</td>
                      <td className="p-3 text-center font-mono text-rose-300">{bom ? bom.shortage_quantity : "-"}</td>
                      <td className="p-3 text-center font-mono font-bold text-rose-300">{bom ? bom.order_quantity : "-"}</td>
                      <td className="p-3 text-center whitespace-nowrap"><Badge className={status === "AVAILABLE" ? "text-emerald-400" : status === "OPTIONAL" ? "text-sky-300" : status === "LOW STOCK" ? "text-amber-300" : "text-rose-300"}>{status}</Badge></td>
                      <td className="p-3 text-right font-mono">{stockItem ? `₹${Number(stockItem.unit_price).toLocaleString("en-IN")}` : "-"}</td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-400">{stockItem ? `₹${(Math.max(0, Number(stockItem.actual_quantity)) * Number(stockItem.unit_price)).toLocaleString("en-IN")}` : "-"}</td>
                      <td className="p-3"><div className="flex justify-center gap-1">
                        {stockItem ? <><button type="button" onClick={() => handleEditItem(stockItem)} className="p-1.5 text-text-secondary hover:text-violet" title="Edit inventory item"><Edit2 size={13} /></button><button type="button" onClick={() => void handleDeleteItem(stockItem.id, stockItem.category)} className="p-1.5 text-text-secondary hover:text-rose-300" title="Delete inventory item"><Trash2 size={13} /></button></> : bom ? <><button type="button" onClick={() => handleEditBomItem(bom)} className="p-1.5 text-text-secondary hover:text-violet" title="Edit BOM item"><Edit2 size={13} /></button><button type="button" onClick={() => void handleDeleteBomItem(bom)} className="p-1.5 text-text-secondary hover:text-rose-300" title="Delete BOM item"><Trash2 size={13} /></button></> : null}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {false && <Card className="border border-border/80 bg-surface overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted text-xs flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-violet" />
            Loading live inventory stock database...
          </div>
        ) : displayStock.length === 0 ? (
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
                {displayStock.map((item) => {
                  const isBulkOrder = isBulkOrderItem(item);
                  const notesData = parseInventoryEntryNotes(item.notes);
                  const requestedQuantity = Math.abs(Number(notesData.bulk_order_quantity || item.actual_quantity || 0));
                  const isLow = !isBulkOrder && item.actual_quantity <= item.min_quantity && item.actual_quantity > 0;
                  const isOut = !isBulkOrder && item.actual_quantity === 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isBulkOrder
                          ? "bg-rose-500/10 hover:bg-rose-500/15"
                          : isOut
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
                        isBulkOrder || isOut ? "text-rose-400 font-black" : isLow ? "text-amber-400 font-black" : ""
                      }`}>
                        {isBulkOrder ? `-${requestedQuantity}` : item.actual_quantity}
                      </td>
                      <td className="p-3.5 text-center text-text-muted font-medium whitespace-nowrap">
                        {item.min_quantity}
                      </td>
                      <td className="p-3.5 text-right font-mono font-medium whitespace-nowrap">
                        ₹{Number(item.unit_price).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-right font-mono font-extrabold text-emerald-400 whitespace-nowrap">
                        ₹{Math.abs(item.total_price).toLocaleString("en-IN")}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        {isBulkOrder ? (
                          <Badge className="bg-rose-600/30 text-rose-300 border border-rose-500/60 font-bold text-[10.5px] px-2.5 py-0.5 shadow-sm">
                            Bulk Order
                          </Badge>
                        ) : isOut ? (
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
                          {isBulkOrder && (
                            <>
                              <button
                                onClick={() => void downloadBulkOrderPdf(item)}
                                title="Download Bulk Order Report"
                                className="p-1.5 text-text-secondary hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors"
                              >
                                <FileText size={14} />
                              </button>
                              <button
                                onClick={() => handleEditBulkItem(item)}
                                title="Edit Bulk Order"
                                className="p-1.5 text-text-secondary hover:text-violet hover:bg-violet/10 rounded transition-colors"
                              >
                                <Edit2 size={14} />
                              </button>
                            </>
                          )}
                          {!isBulkOrder && (
                            <button
                              onClick={() => handleEditItem(item)}
                              title="Edit Stock Entry"
                              className="p-1.5 text-text-secondary hover:text-violet hover:bg-violet/10 rounded transition-colors"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => isBulkOrder ? void handleDeleteBulkOrder(item) : handleDeleteItem(item.id, item.category)}
                            title={isBulkOrder ? "Delete Bulk Order" : "Delete Stock Entry"}
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
      </Card>}

      {/* Bulk Order Modal Dialog */}
      {false && isBulkOrderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-xl border border-border/80 bg-surface shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-border/70 bg-surface-raised/40 flex items-center justify-between">
              <h3 className="text-md font-bold text-text-primary flex items-center gap-2">
                <AlertCircle size={18} className="text-rose-400" />
                Bulk Inventory Order
              </h3>
              <button
                onClick={() => setIsBulkOrderModalOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors text-sm font-bold px-2 py-1"
              >
                X
              </button>
            </div>

            <form onSubmit={handleSaveBulkOrder} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Order Date <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={bulkOrderDate}
                    onChange={(e) => setBulkOrderDate(e.target.value)}
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Inventory Category <span className="text-rose-400">*</span>
                  </Label>
                  <Select
                    value={bulkCategory}
                    onChange={(e) => {
                      setBulkCategory(e.target.value);
                      setBulkSensorType("");
                      setBulkPriceChoice("");
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

                  {bulkCategory === CUSTOM_OPTION_VALUE && (
                    <Input
                      value={bulkCustomCategory}
                      onChange={(e) => {
                        setBulkCustomCategory(e.target.value);
                        setBulkPriceChoice("");
                      }}
                      placeholder="Enter custom category name..."
                      className="bg-surface-raised/50 h-9 mt-1.5"
                      required
                    />
                  )}
                </div>
              </div>

              {(bulkCategory.startsWith("Proxy") || bulkCategory === "Vibration Sensor") && (
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    {bulkCategory.startsWith("Proxy") ? "Proxy Model" : "Vibration Model"}
                  </Label>
                  <Select
                    value={bulkSensorType}
                    onChange={(e) => {
                      setBulkSensorType(e.target.value);
                      setBulkPriceChoice("");
                    }}
                    className="bg-surface-raised/50 h-9"
                  >
                    <option value="">Select model...</option>
                    {(bulkCategory.startsWith("Proxy") ? PROXY_MODELS : VIBRATION_MODELS).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>+ Add Custom Model</option>
                  </Select>

                  {bulkSensorType === CUSTOM_OPTION_VALUE && (
                    <Input
                      value={bulkCustomSensorType}
                      onChange={(e) => {
                        setBulkCustomSensorType(e.target.value);
                        setBulkPriceChoice("");
                      }}
                      placeholder="Enter custom model..."
                      className="bg-surface-raised/50 h-9 mt-1.5"
                    />
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Wanted Quantity <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={bulkQuantity}
                    onChange={(e) => setBulkQuantity(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 10"
                    className="bg-surface-raised/50 h-9"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-text-secondary font-semibold">
                    Price <span className="text-rose-400">*</span>
                  </Label>
                  <Select
                    value={bulkPriceChoice}
                    onChange={(e) => setBulkPriceChoice(e.target.value)}
                    className="bg-surface-raised/50 h-9"
                  >
                    {availableBulkUnitPrices.length ? (
                      <option value="">
                        Current Price - ₹{availableBulkUnitPrices[0].toLocaleString("en-IN")}
                      </option>
                    ) : (
                      <option value="" disabled>
                        No current price
                      </option>
                    )}
                    {availableBulkUnitPrices.slice(1).map((price) => (
                      <option key={price} value={String(price)}>
                        ₹{price.toLocaleString("en-IN")}
                      </option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>+ Add Custom Price</option>
                  </Select>

                  {bulkPriceChoice === CUSTOM_OPTION_VALUE && (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bulkCustomUnitPrice}
                      onChange={(e) => setBulkCustomUnitPrice(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="Enter custom unit price..."
                      className="bg-surface-raised/50 h-9 mt-1.5"
                      required
                    />
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-secondary">
                  Bulk Order Value:
                </span>
                <span className="text-md font-extrabold text-rose-300 font-mono">
                  -{Number(bulkQuantity) || 0} / ₹{bulkOrderTotal.toLocaleString("en-IN")}
                </span>
              </div>

              <div className="space-y-1">
                <Label className="text-text-secondary font-semibold">Remark</Label>
                <Input
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  placeholder="Optional vendor, order, or requirement note..."
                  className="bg-surface-raised/50 h-9"
                />
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={addBulkDraftLine}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-white shadow-md transition hover:bg-rose-600"
                  title={editingBulkDraftIndex === null ? "Add bulk order line" : "Update bulk order line"}
                >
                  <Plus size={19} />
                </button>
              </div>

              {bulkOrderDrafts.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border/70">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-surface-raised/60 text-text-secondary uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-right">Unit Price</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {bulkOrderDrafts.map((draft, index) => (
                        <tr key={`${draft.category}-${draft.sensorType || "item"}-${index}`}>
                          <td className="px-3 py-2 font-bold text-text-primary">
                            {draft.sensorType ? `${draft.category} - ${draft.sensorType}` : draft.category}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-rose-300">-{draft.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono">₹{draft.unitPrice.toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">₹{(draft.quantity * draft.unitPrice).toLocaleString("en-IN")}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => editBulkDraftLine(draft, index)}
                                className="p-1.5 text-text-secondary hover:text-violet hover:bg-violet/10 rounded"
                                title="Edit line"
                              >
                                <Edit2 size={13} />
                              </button>
                              {!editingBulkOrderId && (
                                <button
                                  type="button"
                                  onClick={() => removeBulkDraftLine(index)}
                                  className="p-1.5 text-text-secondary hover:text-rose-300 hover:bg-rose-500/10 rounded"
                                  title="Remove line"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-[11px] font-mono">
                    <span className="text-text-secondary">Total wanted: -{bulkDraftQuantity}</span>
                    <span className="font-bold text-rose-300">₹{bulkDraftTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-border/70 flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsBulkOrderModalOpen(false)}
                  className="h-9 px-4 text-xs cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="h-9 px-5 text-xs bg-rose-500 hover:bg-rose-600 text-white font-semibold flex items-center gap-1.5 cursor-pointer rounded-lg"
                >
                  {saving && <RefreshCw size={14} className="animate-spin" />}
                  {editingBulkOrderId ? "Update Bulk Order" : "Save Bulk Order"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

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
