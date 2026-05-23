import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const { mockInvoke, mockOpen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockOpen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no folders are loaded", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    render(<App />);
    expect(await screen.findByText("No folders added yet.")).toBeInTheDocument();
  });

  it("renders all loaded folders", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/documents", "/home/user/pictures"]);
    render(<App />);
    expect(await screen.findByText("/home/user/documents")).toBeInTheDocument();
    expect(screen.getByText("/home/user/pictures")).toBeInTheDocument();
  });

  it("adds a folder when the dialog confirms a selection", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockOpen.mockResolvedValueOnce("/home/user/new-folder");
    mockInvoke.mockResolvedValueOnce(["/home/user/new-folder"]); // add_folder

    render(<App />);
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("add_folder", {
        path: "/home/user/new-folder",
      });
    });
    expect(screen.getByText("/home/user/new-folder")).toBeInTheDocument();
  });

  it("does nothing when the dialog is cancelled", async () => {
    mockInvoke.mockResolvedValueOnce([]); // get_folders
    mockOpen.mockResolvedValueOnce(null);

    render(<App />);
    await screen.findByText("No folders added yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ Add Folder" }));
    });

    expect(mockInvoke).not.toHaveBeenCalledWith("add_folder", expect.anything());
    expect(screen.getByText("No folders added yet.")).toBeInTheDocument();
  });

  it("removes a folder when Remove is clicked", async () => {
    mockInvoke.mockResolvedValueOnce(["/home/user/documents"]); // get_folders
    mockInvoke.mockResolvedValueOnce([]); // remove_folder

    render(<App />);
    await screen.findByText("/home/user/documents");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("remove_folder", {
        path: "/home/user/documents",
      });
    });
    expect(screen.getByText("No folders added yet.")).toBeInTheDocument();
  });
});
